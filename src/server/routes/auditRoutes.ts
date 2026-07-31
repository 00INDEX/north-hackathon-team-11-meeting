/**
 * Audit API routes for RFC-0001 T2.
 *
 * RFC-0001: 本地会议室查询与预订系统
 */
import { Hono } from 'hono';
import type { Database } from '@/db';
import { AuditEventRepository } from '@/persistence/sqlite/AuditEventRepository';

export function createAuditRoutes(db: Database) {
  const app = new Hono();
  const repository = new AuditEventRepository(db);

  app.get('/', (c) => {
    const targetType = c.req.query('targetType');
    const targetId = c.req.query('targetId');
    return c.json(repository.list({ targetType, targetId }));
  });

  return app;
}
