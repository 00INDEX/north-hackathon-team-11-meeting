import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, openDatabase, runMigrations, type Database } from '@/db';
import { seedDatabase } from '@/db/seedData';
import { appErrorHandler } from '@/errors/hono';
import { createAuditRoutes } from '@/server/routes/auditRoutes';
import { createRoomRoutes } from '@/server/routes/roomRoutes';
import { createRuleRoutes } from '@/server/routes/ruleRoutes';

interface Room {
  id: string;
  name: string;
  openStart: string;
  openEnd: string;
  version: number;
  resources?: Array<{ id: string }>;
}

interface Rule {
  id: string;
  targetType: string;
  targetId: string;
  ruleType: string;
  reason: string;
  enabled: boolean;
  isSystem: boolean;
  recurrence?: string;
  start: string;
  end: string;
  version: number;
}

describe('RFC-0001 T2 room configuration and rule management', () => {
  let db: Database;
  let app: Hono;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), 'meeting-room-t2-'));
    const dbPath = path.join(tempDir, 'meeting-room.sqlite3');
    db = openDatabase({ filePath: dbPath });
    runMigrations(db);
    seedDatabase(db);

    app = new Hono();
    app.onError(appErrorHandler);
    app.route('/api/rooms', createRoomRoutes(db));
    app.route('/api/rules', createRuleRoutes(db));
    app.route('/api/audit-events', createAuditRoutes(db));
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists rooms with combined resources and seeds baseline system rules', async () => {
    const roomsResponse = await app.request('/api/rooms');
    expect(roomsResponse.status).toBe(200);
    const rooms = (await roomsResponse.json()) as Room[];

    expect(rooms).toHaveLength(9);
    expect(rooms.find((room) => room.id === 'room-activity')).toMatchObject({
      name: '活动室',
      openStart: '08:00',
      openEnd: '22:00',
      version: 1,
    });
    expect(rooms.find((room) => room.id === 'room-combined')?.resources?.map((resource) => resource.id)).toEqual([
      'resource-meeting-1',
      'resource-meeting-2',
    ]);

    const rulesResponse = await app.request('/api/rules');
    expect(rulesResponse.status).toBe(200);
    const rules = (await rulesResponse.json()) as Rule[];
    expect(rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'rule-activity-lunch-weekday',
          targetType: 'room',
          targetId: 'room-activity',
          ruleType: 'periodic_block',
          isSystem: true,
          recurrence: JSON.stringify({
            type: 'weekly',
            weekdays: [1, 2, 3, 4, 5],
            timeStart: '11:30',
            timeEnd: '13:30',
          }),
        }),
        expect.objectContaining({
          id: 'rule-502-tuesday-all-day',
          targetType: 'room',
          targetId: 'room-502',
          ruleType: 'periodic_block',
          isSystem: true,
          recurrence: JSON.stringify({
            type: 'weekly',
            weekdays: [2],
            timeStart: '00:00',
            timeEnd: '24:00',
          }),
        }),
      ]),
    );
  });

  it('updates room open hours, audits the change, and rejects stale versions', async () => {
    const patchResponse = await app.request('/api/rooms/room-502', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-actor': 'admin',
        'x-reason': 'open-hours-adjustment',
      },
      body: JSON.stringify({ openStart: '09:00', openEnd: '18:00', version: 1 }),
    });

    expect(patchResponse.status).toBe(200);
    const updatedRoom = (await patchResponse.json()) as Room;
    expect(updatedRoom).toMatchObject({ id: 'room-502', openStart: '09:00', openEnd: '18:00', version: 2 });

    const staleResponse = await app.request('/api/rooms/room-502', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ openStart: '10:00', openEnd: '19:00', version: 1 }),
    });
    expect(staleResponse.status).toBe(409);
    await expect(staleResponse.json()).resolves.toEqual({
      error: expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    });

    const auditResponse = await app.request('/api/audit-events?targetType=room&targetId=room-502');
    expect(auditResponse.status).toBe(200);
    const auditEvents = (await auditResponse.json()) as Array<{ eventType: string; actor: string; reason: string }>;
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'room.updated',
          actor: 'admin',
          reason: 'open-hours-adjustment',
        }),
      ]),
    );
  });

  it('rejects illegal room and rule intervals', async () => {
    const invalidRoomResponse = await app.request('/api/rooms/room-502', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ openStart: '18:00', openEnd: '09:00', version: 1 }),
    });
    expect(invalidRoomResponse.status).toBe(409);
    await expect(invalidRoomResponse.json()).resolves.toEqual({
      error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    });

    const invalidRuleResponse = await app.request('/api/rules', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'rule-invalid',
        targetType: 'room',
        targetId: 'room-504',
        ruleType: 'one_time_block',
        reason: '非法区间',
        start: '2026-01-07T16:00:00.000Z',
        end: '2026-01-07T16:00:00.000Z',
      }),
    });
    expect(invalidRuleResponse.status).toBe(409);
    await expect(invalidRuleResponse.json()).resolves.toEqual({
      error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    });
  });

  it('creates and patches a dynamic rule in place so reads see one current row', async () => {
    const createResponse = await app.request('/api/rules', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-actor': 'admin',
        'x-reason': '504 all-day maintenance',
        'x-idempotency-key': 'rule-504-maintenance-create',
      },
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
    const createdRule = (await createResponse.json()) as Rule;
    expect(createdRule).toMatchObject({
      id: 'rule-504-maintenance',
      targetType: 'room',
      targetId: 'room-504',
      ruleType: 'one_time_block',
      version: 1,
    });

    const rulesAfterCreate = (await (await app.request('/api/rules')).json()) as Rule[];
    expect(rulesAfterCreate.filter((rule) => rule.id === 'rule-504-maintenance')).toHaveLength(1);

    const patchResponse = await app.request('/api/rules/rule-504-maintenance', {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-actor': 'admin',
        'x-reason': 'change to afternoon maintenance',
        'x-idempotency-key': 'rule-504-maintenance-patch',
      },
      body: JSON.stringify({
        start: '2026-01-07T04:00:00.000Z',
        end: '2026-01-07T14:00:00.000Z',
        version: 1,
      }),
    });

    expect(patchResponse.status).toBe(200);
    const patchedRule = (await patchResponse.json()) as Rule;
    expect(patchedRule).toMatchObject({
      id: 'rule-504-maintenance',
      start: '2026-01-07T04:00:00.000Z',
      end: '2026-01-07T14:00:00.000Z',
      version: 2,
    });

    const rulesAfterPatch = (await (await app.request('/api/rules')).json()) as Rule[];
    expect(rulesAfterPatch.filter((rule) => rule.id === 'rule-504-maintenance')).toHaveLength(1);

    const staleRuleResponse = await app.request('/api/rules/rule-504-maintenance', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false, version: 1 }),
    });
    expect(staleRuleResponse.status).toBe(409);
    await expect(staleRuleResponse.json()).resolves.toEqual({
      error: expect.objectContaining({ code: 'VERSION_CONFLICT' }),
    });

    const auditResponse = await app.request('/api/audit-events?targetType=rule&targetId=rule-504-maintenance');
    expect(auditResponse.status).toBe(200);
    const auditEvents = (await auditResponse.json()) as Array<{
      eventType: string;
      idempotencyKey: string | null;
    }>;
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'rule.created',
          idempotencyKey: 'rule-504-maintenance-create',
        }),
        expect.objectContaining({
          eventType: 'rule.updated',
          idempotencyKey: 'rule-504-maintenance-patch',
        }),
      ]),
    );
  });

  it('protects baseline system rules from physical deletion', async () => {
    const deleteResponse = await app.request('/api/rules/rule-502-tuesday-all-day', { method: 'DELETE' });
    expect(deleteResponse.status).toBe(409);
    await expect(deleteResponse.json()).resolves.toEqual({
      error: expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    });

    const rulesResponse = await app.request('/api/rules');
    expect(rulesResponse.status).toBe(200);
    const rules = (await rulesResponse.json()) as Rule[];
    expect(rules.find((rule) => rule.id === 'rule-502-tuesday-all-day')).toMatchObject({
      isSystem: true,
      enabled: true,
    });
  });
});
