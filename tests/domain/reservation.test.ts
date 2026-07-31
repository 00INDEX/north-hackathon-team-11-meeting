import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, runMigrations, type Database } from '@/db';
import { seedDatabase } from '@/db/seedData';
import { AppError } from '@/errors/AppError';
import { ReservationService } from '@/domain/reservation/ReservationService';
import { AuditEventRepository } from '@/persistence/sqlite/AuditEventRepository';
import { ReservationRepository } from '@/persistence/sqlite/ReservationRepository';
import { combineLocalDateTime } from '@/time';

describe('RFC-0001 T4 reservation lifecycle and administrator adjustment', () => {
  let db: Database;
  let tempDir: string;
  let service: ReservationService;
  let reservations: ReservationRepository;
  let audits: AuditEventRepository;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'meeting-room-t4-'));
    const dbPath = path.join(tempDir, 'meeting-room.sqlite3');
    db = openDatabase({ filePath: dbPath });
    runMigrations(db);
    seedDatabase(db);
    service = new ReservationService(db);
    reservations = new ReservationRepository(db);
    audits = new AuditEventRepository(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a clear reservation conflict for overlapping bookings', () => {
    const start = combineLocalDateTime('2026-01-07', '09:00');
    const end = combineLocalDateTime('2026-01-07', '10:00');
    service.create({
      id: 'reservation-existing',
      title: '产品评审',
      roomId: 'room-meeting-1',
      start,
      end,
    });

    try {
      service.create({
        id: 'reservation-overlap',
        title: '设计评审',
        roomId: 'room-meeting-1',
        start,
        end,
      });
      throw new Error('Expected overlapping create to fail');
    } catch (error) {
      const appError = error as AppError;
      expect(appError.code).toBe('RESERVATION_CONFLICT');
      expect(appError.conflicts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'reservation',
            id: 'reservation-existing',
            name: '产品评审',
            start,
            end,
            reason: '同一物理资源存在有效预约',
          }),
        ]),
      );
    }
  });

  it('releases the slot after cancel and is idempotent for repeated cancel', () => {
    const reservation = service.create({
      id: 'reservation-cancel-release',
      title: '项目同步',
      roomId: 'room-meeting-1',
      start: combineLocalDateTime('2026-01-07', '09:00'),
      end: combineLocalDateTime('2026-01-07', '10:00'),
    });

    const cancelled = service.cancel(reservation.id, { reason: '会议改期' });
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledReason).toBe('会议改期');
    expect(service.cancel(reservation.id, { reason: '重复取消' })).toMatchObject({
      id: reservation.id,
      status: 'cancelled',
    });

    const replacement = service.create({
      id: 'reservation-after-cancel',
      title: '补位会议',
      roomId: 'room-meeting-1',
      start: reservation.start,
      end: reservation.end,
    });
    expect(replacement.id).toBe('reservation-after-cancel');
    expect(service.list({ status: 'cancelled' })).toEqual(expect.arrayContaining([expect.objectContaining({ id: reservation.id })]));
  });

  it('blocks room-meeting-1 and room-meeting-2 when the combined space is booked', () => {
    const combined = service.create({
      id: 'reservation-combined',
      title: '全员周会',
      roomId: 'room-combined',
      start: combineLocalDateTime('2026-01-07', '09:00'),
      end: combineLocalDateTime('2026-01-07', '10:00'),
    });

    expect(combined.roomId).toBe('room-combined');
    expect(reservations.resourceSnapshotsForReservation(combined.id).map((snapshot) => snapshot.resourceId)).toEqual([
      'resource-meeting-1',
      'resource-meeting-2',
    ]);

    expect(() =>
      service.create({
        id: 'reservation-meeting-1-conflict',
        title: '会议室一冲突',
        roomId: 'room-meeting-1',
        start: combined.start,
        end: combined.end,
      }),
    ).toThrow(expect.objectContaining({ code: 'RESERVATION_CONFLICT' }));
    expect(() =>
      service.create({
        id: 'reservation-meeting-2-conflict',
        title: '会议室二冲突',
        roomId: 'room-meeting-2',
        start: combined.start,
        end: combined.end,
      }),
    ).toThrow(expect.objectContaining({ code: 'RESERVATION_CONFLICT' }));
  });

  it('force-adjusts atomically, records the reason, and leaves no post-submit overlap', () => {
    const displacedStart = combineLocalDateTime('2026-01-07', '09:00');
    const displacedEnd = combineLocalDateTime('2026-01-07', '10:00');
    const displaced = service.create({
      id: 'reservation-displaced',
      title: '被调整会议',
      roomId: 'room-meeting-1',
      start: displacedStart,
      end: displacedEnd,
    });
    const adjusted = service.create({
      id: 'reservation-admin-adjust',
      title: '管理员调整会议',
      roomId: 'room-meeting-2',
      start: combineLocalDateTime('2026-01-07', '08:00'),
      end: combineLocalDateTime('2026-01-07', '09:00'),
    });

    const result = service.forceAdjust(adjusted.id, {
      roomId: 'room-meeting-1',
      start: displacedStart,
      end: displacedEnd,
      reason: '客户临时到访，需要腾出会议室一',
      force: true,
      idempotencyKey: 'force-adjust-room-meeting-1',
    });

    expect(result.cancelledReservations).toEqual([expect.objectContaining({ id: displaced.id, status: 'cancelled' })]);
    expect(reservations.findById(displaced.id)).toMatchObject({
      id: displaced.id,
      status: 'cancelled',
      cancelledReason: '客户临时到访，需要腾出会议室一',
    });
    expect(result.reservation).toMatchObject({
      id: adjusted.id,
      roomId: 'room-meeting-1',
      start: displacedStart,
      end: displacedEnd,
      version: 2,
    });
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reservationId: displaced.id,
          resourceId: 'resource-meeting-1',
        }),
      ]),
    );

    const auditEvents = audits.list({ idempotencyKey: 'force-adjust-room-meeting-1' });
    expect(auditEvents.map((audit) => audit.eventType)).toEqual(
      expect.arrayContaining(['reservation.force_adjusted', 'reservation.cancelled_by_force']),
    );
    expect(auditEvents.every((audit) => audit.reason === '客户临时到访，需要腾出会议室一')).toBe(true);
    const secondForce = service.forceAdjust(adjusted.id, {
      roomId: 'room-meeting-1',
      start: displacedStart,
      end: displacedEnd,
      reason: '客户临时到访，需要腾出会议室一',
      force: true,
      idempotencyKey: 'force-adjust-room-meeting-1',
    });
    expect(new Set(secondForce.auditEventIds)).toEqual(new Set(auditEvents.map((audit) => audit.id)));
  });

  it('keeps only one active reservation for the same resource and time slot', () => {
    const first = service.create({
      id: 'reservation-concurrent-first',
      title: '并发预约一',
      roomId: 'room-meeting-1',
      start: '2026-01-07T01:00:00.000Z',
      end: '2026-01-07T02:00:00.000Z',
    });

    expect(() =>
      service.create({
        id: 'reservation-concurrent-second',
        title: '并发预约二',
        roomId: 'room-meeting-1',
        start: '2026-01-07T01:00:00.000Z',
        end: '2026-01-07T02:00:00.000Z',
      }),
    ).toThrow(expect.objectContaining({ code: 'RESERVATION_CONFLICT' }));
    expect(first.id).toBe('reservation-concurrent-first');
    expect(reservations.list({ roomId: 'room-meeting-1' })).toHaveLength(1);
  });

  it('returns the same reservation for idempotent create submissions', () => {
    const first = service.create({
      id: 'reservation-idempotent',
      title: '幂等提交',
      roomId: 'room-meeting-1',
      start: combineLocalDateTime('2026-01-07', '09:00'),
      end: combineLocalDateTime('2026-01-07', '10:00'),
      idempotencyKey: 'reservation-idempotency-key',
    });
    const second = service.create({
      id: 'reservation-idempotent',
      title: '幂等提交',
      roomId: 'room-meeting-1',
      start: combineLocalDateTime('2026-01-07', '09:00'),
      end: combineLocalDateTime('2026-01-07', '10:00'),
      idempotencyKey: 'reservation-idempotency-key',
    });

    expect(second).toMatchObject({ id: first.id, title: '幂等提交', version: 1 });
    expect(reservations.list()).toHaveLength(1);
  });
});
