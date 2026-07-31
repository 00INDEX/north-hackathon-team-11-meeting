import type { Context } from 'hono';
import type { AuditContext } from '@/domain/audit/AuditService';

export function auditContextFromHeaders(c: Context): AuditContext {
  return {
    actor: c.req.header('x-actor') ?? 'local-user',
    reason: c.req.header('x-reason') ?? '',
    idempotencyKey: c.req.header('x-idempotency-key') ?? null,
  };
}
