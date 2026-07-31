import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, getMigrations, openDatabase, runMigrations } from '@/db';
import type { Database } from '@/db';
import { seedDatabase } from '@/db/seedData';
import { AuditEventRepository } from '@/persistence/sqlite/AuditEventRepository';
import { AvailabilityRuleRepository } from '@/persistence/sqlite/AvailabilityRuleRepository';
import { ReservationRepository } from '@/persistence/sqlite/ReservationRepository';
import { RoomRepository } from '@/persistence/sqlite/RoomRepository';

describe('SQLite migrations and seed data', () => {
  let db: Database;
  let dbPath: string;

  beforeEach(() => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'meeting-room-baseline-'));
    dbPath = path.join(tempDir, 'meeting-room.sqlite3');
    db = openDatabase({ filePath: dbPath });
    runMigrations(db);
  });

  afterEach(() => {
    if (db) {
      closeDatabase(db);
    }
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('migrates an empty database idempotently', () => {
    runMigrations(db);

    expect(getMigrations(db).map((migration) => migration.id)).toEqual([1]);
    const tableNames = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;

    expect(tableNames.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'rooms',
        'resources',
        'room_resources',
        'reservations',
        'reservation_resources',
        'availability_rules',
        'audit_events',
        'schema_migrations',
      ]),
    );
  });

  it('seeds the baseline rooms, combined mapping, rules and persistence repositories idempotently', () => {
    seedDatabase(db);
    seedDatabase(db);

    const roomRepository = new RoomRepository(db);
    const rooms = roomRepository.listWithResources();
    const names = rooms.map((room) => room.name);

    expect(names).toEqual(
      expect.arrayContaining(['活动室', '会议室一', '会议室二', '组合空间', '502', '503', '504', '505', '506']),
    );
    expect(rooms).toHaveLength(9);

    const combined = rooms.find((room) => room.id === 'room-combined');
    expect(combined?.resources.map((resource) => resource.id)).toEqual(['resource-meeting-1', 'resource-meeting-2']);

    const smallRoomNames = rooms
      .filter((room) => ['502', '503', '504', '505', '506'].includes(room.name))
      .map((room) => room.name);
    expect(smallRoomNames).toEqual(['502', '503', '504', '505', '506']);

    const ruleRepository = new AvailabilityRuleRepository(db);
    const rules = ruleRepository.list();
    expect(new Set(rules.map((rule) => rule.id))).toEqual(
      new Set(['rule-activity-lunch-weekday', 'rule-502-tuesday-all-day']),
    );
    expect(new Set(rules.map((rule) => rule.targetId))).toEqual(new Set(['room-activity', 'room-502']));

    const reservationRepository = new ReservationRepository(db);
    const reservation = reservationRepository.upsert({
      id: 'reservation-baseline',
      title: '基线预约',
      roomId: 'room-activity',
      start: '2026-01-07T01:00:00.000Z',
      end: '2026-01-07T02:00:00.000Z',
    });
    reservationRepository.upsertResourceSnapshot({
      reservationId: reservation.id,
      resourceId: 'resource-activity',
      roomId: 'room-activity',
      start: reservation.start,
      end: reservation.end,
      version: 1,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    });

    expect(reservationRepository.resourceSnapshotsForReservation(reservation.id)).toEqual([
      expect.objectContaining({
        reservationId: reservation.id,
        resourceId: 'resource-activity',
        roomId: 'room-activity',
      }),
    ]);

    const auditRepository = new AuditEventRepository(db);
    const auditEvent = auditRepository.insert({
      id: 'audit-baseline',
      eventType: 'room.seeded',
      actor: 'local-user',
      targetType: 'room',
      targetId: 'room-activity',
      before: { enabled: true },
      after: { enabled: true },
    });

    expect(auditRepository.findById(auditEvent.id)?.eventType).toBe('room.seeded');
    expect(roomRepository.listResources()).toHaveLength(8);
  });
});
