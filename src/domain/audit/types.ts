export interface AuditEvent {
  id: string;
  eventType: string;
  actor: string;
  reason: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  idempotencyKey?: string | null;
  createdAt: string;
}

export interface CreateAuditEventInput {
  id: string;
  eventType: string;
  actor?: string;
  reason?: string;
  targetType: string;
  targetId: string;
  before?: unknown;
  after?: unknown;
  idempotencyKey?: string | null;
  createdAt?: string;
}
