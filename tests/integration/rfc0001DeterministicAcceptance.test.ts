import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, runMigrations, type Database } from '@/db';
import { seedDatabase } from '@/db/seedData';
import { appErrorHandler } from '@/errors/hono';
import { createAuditRoutes } from '@/server/routes/auditRoutes';
import { createAvailabilityRoutes } from '@/server/routes/availabilityRoutes';
import { createReservationRoutes } from '@/server/routes/reservationRoutes';
import { createRoomRoutes } from '@/server/routes/roomRoutes';
import { createRuleRoutes } from '@/server/routes/ruleRoutes';
import { combineLocalDateTime } from '@/time';

interface AvailableRoom {
  id: string;
  name: string;
}

interface Reservation {
  id: string;
  status: string;
  roomId: string;
}

let app: Hono;
let db: Database;
let tempDir: string;

describe('RFC-0001 T6 deterministic cross-layer acceptance scenarios', () => {
  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'meeting-room-t6-'));
    db = openDatabase({ filePath: path.join(tempDir, 'meeting-room.sqlite3') });
    runMigrations(db);
    seedDatabase(db);

    app = new Hono();
    app.onError(appErrorHandler);
    app.route('/api/rooms', createRoomRoutes(db));
    app.route('/api/rules', createRuleRoutes(db));
    app.route('/api', createAvailabilityRoutes(db));
    app.route('/api/reservations', createReservationRoutes(db));
    app.route('/api/audit-events', createAuditRoutes(db));
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('runs fixed-date acceptance scenarios across API, domain, SQLite and UI-adjacent surfaces', async () => {
    await expectFixedRules();
    await expectRuleCorrection();
    await expectCombinedBookingConflict();
    await expectCancellationRelease();
    await expectAdministratorForceAdjustment();
  });
});

async function expectFixedRules(): Promise<void> {
  const tuesdayRooms = await requestAvailableRooms(
    '/api/availability?start=2026-01-06T02:00:00.000Z&end=2026-01-06T03:00:00.000Z&capacity=6',
  );
  expect(tuesdayRooms.map((room) => room.name)).toEqual(['503', '504', '505', '506']);

  const lunchRooms = await requestAvailableRooms(
    `/api/availability?start=${encodeURIComponent(combineLocalDateTime('2026-01-07', '11:30'))}&end=${encodeURIComponent(
      combineLocalDateTime('2026-01-07', '13:30'),
    )}`,
  );
  expect(lunchRooms.map((room) => room.id)).not.toContain('room-activity');
}

async function expectRuleCorrection(): Promise<void> {
  const createResponse = await app.request('/api/rules', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-actor': 'admin' },
    body: JSON.stringify({
      id: 'rule-504-maintenance',
      targetType: 'room',
      targetId: 'room-504',
      ruleType: 'one_time_block',
      reason: '504 all-day maintenance',
      start: '2026-01-07T00:00:00.000Z',
      end: '2026-01-08T00:00:00.000Z',
    }),
  });
  expect(createResponse.status).toBe(201);

  let morningRooms = await requestAvailableRooms(
    '/api/availability?start=2026-01-07T01:00:00.000Z&end=2026-01-07T02:00:00.000Z&capacity=6',
  );
  expect(morningRooms.map((room) => room.id)).toContain('room-504');

  const patchResponse = await app.request('/api/rules/rule-504-maintenance', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-actor': 'admin' },
    body: JSON.stringify({
      start: '2026-01-07T04:00:00.000Z',
      end: '2026-01-07T14:00:00.000Z',
      version: 1,
    }),
  });
  expect(patchResponse.status).toBe(200);

  morningRooms = await requestAvailableRooms(
    '/api/availability?start=2026-01-07T01:00:00.000Z&end=2026-01-07T02:00:00.000Z&capacity=6',
  );
  const afternoonRooms = await requestAvailableRooms(
    '/api/availability?start=2026-01-07T07:00:00.000Z&end=2026-01-07T08:00:00.000Z&capacity=6',
  );
  expect(morningRooms.map((room) => room.id)).toContain('room-504');
  expect(afternoonRooms.map((room) => room.id)).not.toContain('room-504');

  const rulesResponse = await app.request('/api/rules');
  expect(rulesResponse.status).toBe(200);
  const rules = (await rulesResponse.json()) as Array<{ id: string; start: string; end: string; version: number }>;
  expect(rules.filter((rule) => rule.id === 'rule-504-maintenance')).toEqual([
    expect.objectContaining({
      start: '2026-01-07T04:00:00.000Z',
      end: '2026-01-07T14:00:00.000Z',
      version: 2,
    }),
  ]);
}

async function expectCombinedBookingConflict(): Promise<void> {
  const start = combineLocalDateTime('2026-01-07', '09:00');
  const end = combineLocalDateTime('2026-01-07', '10:00');
  const combined = await createReservation('reservation-combined-t6', '组合预约', 'room-combined', start, end);
  expect(combined.roomId).toBe('room-combined');

  const conflictResponse = await app.request('/api/reservations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: 'reservation-meeting-1-conflict-t6',
      title: '组合预约冲突',
      roomId: 'room-meeting-1',
      start,
      end,
    }),
  });
  expect(conflictResponse.status).toBe(409);
  await expect(conflictResponse.json()).resolves.toEqual({
    error: expect.objectContaining({ code: 'RESERVATION_CONFLICT' }),
  });
}

async function expectCancellationRelease(): Promise<void> {
  const start = combineLocalDateTime('2026-01-07', '09:00');
  const end = combineLocalDateTime('2026-01-07', '10:00');
  const reservation = await createReservation('reservation-cancel-t6', '取消释放', 'room-meeting-1', start, end);

  const cancelResponse = await app.request(`/api/reservations/${reservation.id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '会议改期' }),
  });
  expect(cancelResponse.status).toBe(200);
  await expect(cancelResponse.json()).resolves.toMatchObject({ id: reservation.id, status: 'cancelled' });

  const replacement = await createReservation('reservation-replacement-t6', '补位会议', 'room-meeting-1', start, end);
  expect(replacement.id).toBe('reservation-replacement-t6');

  const repeatedCancelResponse = await app.request(`/api/reservations/${reservation.id}/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: '重复取消' }),
  });
  expect(repeatedCancelResponse.status).toBe(200);
  await expect(repeatedCancelResponse.json()).resolves.toMatchObject({ id: reservation.id, status: 'cancelled' });
}

async function expectAdministratorForceAdjustment(): Promise<void> {
  const start = combineLocalDateTime('2026-01-07', '10:00');
  const end = combineLocalDateTime('2026-01-07', '11:00');
  const displaced = await createReservation('reservation-displaced-t6', '被调整会议', 'room-meeting-1', start, end);
  const adjusted = await createReservation('reservation-admin-adjust-t6', '管理员调整会议', 'room-meeting-2', start, end);

  const adjustResponse = await app.request(`/api/reservations/${adjusted.id}/force-adjust`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-actor': 'admin',
      'x-reason': '客户临时到访，需要腾出会议室一',
      'x-idempotency-key': 'force-adjust-room-meeting-1-t6',
    },
    body: JSON.stringify({
      roomId: 'room-meeting-1',
      start,
      end,
      reason: '客户临时到访，需要腾出会议室一',
      force: true,
      idempotencyKey: 'force-adjust-room-meeting-1-t6',
    }),
  });
  expect(adjustResponse.status).toBe(200);
  await expect(adjustResponse.json()).resolves.toMatchObject({
    reservation: expect.objectContaining({ id: adjusted.id, roomId: 'room-meeting-1' }),
    cancelledReservations: [expect.objectContaining({ id: displaced.id, status: 'cancelled' })],
  });

  const reservationsResponse = await app.request('/api/reservations?roomId=room-meeting-1');
  expect(reservationsResponse.status).toBe(200);
  const reservations = (await reservationsResponse.json()) as Reservation[];
  expect(reservations.map((reservation) => reservation.id)).toEqual(
    expect.arrayContaining(['reservation-displaced-t6', 'reservation-admin-adjust-t6']),
  );
  expect(reservations.find((reservation) => reservation.id === 'reservation-displaced-t6')).toMatchObject({
    status: 'cancelled',
  });

  const auditResponse = await app.request(
    '/api/audit-events?targetType=reservation&targetId=reservation-admin-adjust-t6&idempotencyKey=force-adjust-room-meeting-1-t6',
  );
  expect(auditResponse.status).toBe(200);
  const auditEvents = (await auditResponse.json()) as Array<{ eventType: string; reason: string }>;
  expect(auditEvents.map((audit) => audit.eventType)).toContain('reservation.force_adjusted');
  expect(auditEvents.every((audit) => audit.reason === '客户临时到访，需要腾出会议室一')).toBe(true);
}

async function createReservation(
  id: string,
  title: string,
  roomId: string,
  start: string,
  end: string,
): Promise<Reservation> {
  const response = await app.request('/api/reservations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id, title, roomId, start, end }),
  });
  expect(response.status).toBe(201);
  return (await response.json()) as Reservation;
}

async function requestAvailableRooms(pathname: string): Promise<AvailableRoom[]> {
  const response = await app.request(pathname);
  expect(response.status).toBe(200);
  return (await response.json()) as AvailableRoom[];
}
