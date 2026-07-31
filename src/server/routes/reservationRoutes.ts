import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Database } from '@/db';
import { AppError } from '@/errors/AppError';
import { ReservationService } from '@/domain/reservation/ReservationService';
import type { ReservationListFilters } from '@/domain/reservation/ReservationService';
import type { AuditContext } from '@/domain/audit/AuditService';
import type {
  CancelReservationInput,
  CreateReservationInput,
  ForceAdjustReservationInput,
  UpdateReservationInput,
} from '@/domain/reservation/types';

export function createReservationRoutes(db: Database): Hono {
  const app = new Hono();
  const service = new ReservationService(db);

  app.get('/', (c) => {
    const filters: ReservationListFilters = {};
    const from = c.req.query('from');
    const to = c.req.query('to');
    const roomId = c.req.query('roomId');
    const status = c.req.query('status');
    if (from) {
      filters.from = from;
    }
    if (to) {
      filters.to = to;
    }
    if (roomId) {
      filters.roomId = roomId;
    }
    if (status) {
      filters.status = status;
    }
    return c.json(service.list(filters));
  });

  app.get('/:reservationId', (c) => {
    const reservation = service.findById(c.req.param('reservationId'));
    if (!reservation) {
      throw new AppError('NOT_FOUND', `预约不存在: ${c.req.param('reservationId')}`, {
        conflicts: [{ type: 'reservation', id: c.req.param('reservationId'), name: c.req.param('reservationId') }],
      });
    }
    return c.json(reservation);
  });

  app.post('/', async (c) => {
    const body = (await c.req.json()) as CreateReservationInput;
    const reservation = service.create(body, auditContext(c));
    return c.json(reservation, 201);
  });

  app.patch('/:reservationId', async (c) => {
    const body = (await c.req.json()) as UpdateReservationInput;
    const reservation = service.update(c.req.param('reservationId'), body, auditContext(c));
    return c.json(reservation);
  });

  app.post('/:reservationId/cancel', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as CancelReservationInput;
    const reservation = service.cancel(c.req.param('reservationId'), body, auditContext(c));
    return c.json(reservation);
  });

  app.post('/:reservationId/force-adjust', async (c) => {
    const body = (await c.req.json()) as ForceAdjustReservationInput;
    const result = service.forceAdjust(c.req.param('reservationId'), body, auditContext(c));
    return c.json(result);
  });

  return app;
}

function auditContext(c: Context): AuditContext {
  return {
    actor: c.req.header('x-actor') ?? 'local-user',
    reason: c.req.header('x-reason') ?? '',
    idempotencyKey: c.req.header('x-idempotency-key') ?? null,
  };
}
