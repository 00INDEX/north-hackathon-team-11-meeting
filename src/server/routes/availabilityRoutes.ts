/**
 * Availability API routes for RFC-0001 T3.
 *
 * RFC-0001: 本地会议室查询与预订系统
 */
import { Hono } from 'hono';
import type { Database } from '@/db';
import { AvailabilityService } from '@/domain/availability';
import { AppError } from '@/errors/AppError';

export function createAvailabilityRoutes(db: Database) {
  const app = new Hono();
  const service = new AvailabilityService(db);

  app.get('/availability', (c) => {
    const query = c.req.query('start');
    const end = c.req.query('end');
    const capacity = parseOptionalNumber(c.req.query('capacity'), 'capacity');
    const equipment = parseEquipment(c.req.queries('equipment') ?? []);

    return c.json(service.findAvailableRooms({
      start: query ?? '',
      end: end ?? '',
      capacity,
      equipment,
    }));
  });

  return app;
}

function parseOptionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AppError('VALIDATION_ERROR', `${name} 必须是数字`);
  }
  return parsed;
}

function parseEquipment(values: string[]): string[] | undefined {
  if (values.length === 0) {
    return undefined;
  }
  return values.flatMap((value) => value.split(',')).map((item) => item.trim()).filter(Boolean);
}
