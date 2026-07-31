/**
 * Audit write service for RFC-0001 management operations.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * Generates stable audit event IDs and defaults the local single-user actor.
 */
import { randomUUID } from 'node:crypto';
import type { AuditEventRepository } from '@/persistence/sqlite/AuditEventRepository';
import type { CreateAuditEventInput } from './types';

export interface AuditContext {
  actor?: string;
  reason?: string;
  idempotencyKey?: string | null;
}

export class AuditService {
  constructor(private readonly repository: AuditEventRepository) {}

  record(input: CreateAuditEventInput, context: AuditContext = {}): ReturnType<AuditEventRepository['insert']> {
    return this.repository.insert({
      ...input,
      id: input.id ?? randomUUID(),
      actor: context.actor ?? 'local-user',
      reason: context.reason ?? input.reason ?? '',
      idempotencyKey: context.idempotencyKey ?? input.idempotencyKey ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    });
  }
}
