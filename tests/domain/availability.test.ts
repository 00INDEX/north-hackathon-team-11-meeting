import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, runMigrations, type Database } from '@/db';
import { seedDatabase } from '@/db/seedData';
import { AvailabilityService } from '@/domain/availability';
import { combineLocalDateTime } from '@/time';
import { intervalsOverlap, parseUtcInterval } from '@/domain/availability/interval';
import { ReservationRepository } from '@/persistence/sqlite/ReservationRepository';
import { createAvailabilityRoutes } from '@/server/routes/availabilityRoutes';
import { createRoomRoutes } from '@/server/routes/roomRoutes';
import { appErrorHandler } from '@/errors/hono';

interface AvailableRoom {
  id: string;
  name: string;
  capacity: number;
}

describe('RFC-0001 T3 availability and conflict engine', () => {
  let db: Database;
  let tempDir: string;
  let service: AvailabilityService;
  let app: Hono;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'meeting-room-t3-'));
    const dbPath = path.join(tempDir, 'meeting-room.sqlite3');
    db = openDatabase({ filePath: dbPath });
    runMigrations(db);
    seedDatabase(db);
    service = new AvailabilityService(db);

    app = new Hono();
    app.onError(appErrorHandler);
    app.route('/api/rooms', createRoomRoutes(db));
    app.route('/api', createAvailabilityRoutes(db));
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('treats half-open intervals as non-overlapping when one ends exactly when the other starts', () => {
    const left = parseUtcInterval('2026-01-06T02:00:00.000Z', '2026-01-06T03:00:00.000Z');
    const right = parseUtcInterval('2026-01-06T03:00:00.000Z', '2026-01-06T04:00:00.000Z');

    expect(intervalsOverlap(left, right)).toBe(false);
    expect(intervalsOverlap(right, left)).toBe(false);
  });

  it('detects partial overlaps and containment with half-open UTC intervals', () => {
    const query = parseUtcInterval('2026-01-06T02:00:00.000Z', '2026-01-06T04:00:00.000Z');

    expect(intervalsOverlap(query, parseUtcInterval('2026-01-06T03:00:00.000Z', '2026-01-06T05:00:00.000Z'))).toBe(true);
    expect(intervalsOverlap(query, parseUtcInterval('2026-01-06T02:30:00.000Z', '2026-01-06T03:30:00.000Z'))).toBe(true);
    expect(intervalsOverlap(query, parseUtcInterval('2026-01-06T04:00:00.000Z', '2026-01-06T05:00:00.000Z'))).toBe(false);
  });

  it('returns next Tuesday 10:00-11:00 small rooms and excludes the Tuesday-only 502 rule', async () => {
    const response = await app.request('/api/availability?start=2026-01-06T02:00:00.000Z&end=2026-01-06T03:00:00.000Z&capacity=6');
    expect(response.status).toBe(200);
    const rooms = (await response.json()) as AvailableRoom[];

    expect(rooms.map((room) => room.name)).toEqual(['503', '504', '505', '506']);
  });

  it('marks the activity room unavailable during its weekday lunch blocking rule', () => {
    const result = service.checkAvailability({
      roomId: 'room-activity',
      start: combineLocalDateTime('2026-01-07', '11:30'),
      end: combineLocalDateTime('2026-01-07', '13:30'),
    });

    expect(result.isAvailable).toBe(false);
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'rule',
          id: 'rule-activity-lunch-weekday',
          start: '2026-01-07T03:30:00.000Z',
          end: '2026-01-07T05:30:00.000Z',
        }),
      ]),
    );
  });

  it('reports outside-open-hours conflicts for cross-day availability checks', () => {
    const result = service.checkAvailability({
      roomId: 'room-activity',
      start: combineLocalDateTime('2026-01-06', '22:30'),
      end: combineLocalDateTime('2026-01-07', '07:30'),
    });

    expect(result.isAvailable).toBe(false);
    expect(result.conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'time',
          start: '2026-01-06T14:30:00.000Z',
          end: '2026-01-06T16:00:00.000Z',
        }),
        expect.objectContaining({
          type: 'time',
          start: '2026-01-06T16:00:00.000Z',
          end: '2026-01-06T23:30:00.000Z',
        }),
      ]),
    );
  });

  it('does not return the combined space when only one underlying resource is free', async () => {
    const reservationRepository = new ReservationRepository(db);
    const reservation = reservationRepository.upsert({
      id: 'reservation-combined-resource-conflict',
      title: '占用组合空间资源一',
      roomId: 'room-meeting-1',
      start: combineLocalDateTime('2026-01-07', '09:00'),
      end: combineLocalDateTime('2026-01-07', '10:00'),
    });
    reservationRepository.upsertResourceSnapshot({
      reservationId: reservation.id,
      resourceId: 'resource-meeting-1',
      roomId: 'room-meeting-1',
      start: reservation.start,
      end: reservation.end,
      version: 1,
      createdAt: '2026-07-31T00:00:00.000Z',
      updatedAt: '2026-07-31T00:00:00.000Z',
    });

    const response = await app.request('/api/availability?start=2026-01-07T01:00:00.000Z&end=2026-01-07T02:00:00.000Z&capacity=24');
    expect(response.status).toBe(200);
    const rooms = (await response.json()) as AvailableRoom[];

    expect(rooms.map((room) => room.id)).not.toContain('room-combined');
  });

  it('renders calendar blocks for periodic rules', () => {
    const calendar = service.getRoomCalendar('room-activity', '2026-01-07T00:00:00.000Z', '2026-01-08T00:00:00.000Z');

    expect(calendar.blocks).toEqual([
      expect.objectContaining({
        kind: 'block',
        ruleId: 'rule-activity-lunch-weekday',
        start: '2026-01-07T03:30:00.000Z',
        end: '2026-01-07T05:30:00.000Z',
      }),
    ]);
  });
});
