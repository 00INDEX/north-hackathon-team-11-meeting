import type { Database } from '@/db';
import type { CreateAuditEventInput, AuditEvent } from '@/domain/audit/types';
import { mapAuditEventRow, serializeAuditEvent, type AuditEventRow } from '@/persistence/sqlite/mappers';

export class AuditEventRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): AuditEvent | undefined {
    const row = this.db.prepare('SELECT * FROM audit_events WHERE id = ?').get(id) as AuditEventRow | undefined;
    return row ? mapAuditEventRow(row) : undefined;
  }

  list(): AuditEvent[] {
    return (this.db.prepare('SELECT * FROM audit_events ORDER BY created_at, id').all() as AuditEventRow[]).map((row) =>
      mapAuditEventRow(row),
    );
  }

  insert(input: CreateAuditEventInput): AuditEvent {
    const row = serializeAuditEvent(input);
    this.db
      .prepare(
        `INSERT INTO audit_events (
          id, event_type, actor, reason, target_type, target_id, before_json, after_json, idempotency_key, created_at
        ) VALUES (
          @id, @event_type, @actor, @reason, @target_type, @target_id, @before_json, @after_json, @idempotency_key, @created_at
        )`,
      )
      .run(row);

    return this.findById(input.id) as AuditEvent;
  }
}
