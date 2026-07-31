/**
 * Room management API routes for RFC-0001 T2.
 *
 * RFC-0001: 本地会议室查询与预订系统
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Database } from '@/db';
import type { AuditContext } from '@/domain/audit/AuditService';
import { RoomService } from '@/domain/room/RoomService';
import type { CreateRoomInput, UpdateRoomInput } from '@/domain/room/types';

export function createRoomRoutes(db: Database) {
  const app = new Hono();
  const service = new RoomService(db);

  app.get('/', (c) => c.json(service.listWithResources()));

  app.get('/:roomId', (c) => {
    const room = service.findById(c.req.param('roomId'));
    if (!room) {
      return c.json({ error: { code: 'NOT_FOUND', message: `房间不存在: ${c.req.param('roomId')}` } }, 404);
    }
    return c.json(room);
  });

  app.post('/', async (c) => {
    const body = (await c.req.json()) as CreateRoomInput;
    return c.json(service.create(body, auditContext(c)), 201);
  });

  app.patch('/:roomId', async (c) => {
    const patch = (await c.req.json()) as UpdateRoomInput;
    return c.json(service.update(c.req.param('roomId'), patch, auditContext(c)));
  });

  return app;
}

function auditContext(c: Context): AuditContext {
  return {
    actor: c.req.header('x-actor') ?? 'local-user',
    reason: c.req.header('x-reason') ?? '',
  };
}
