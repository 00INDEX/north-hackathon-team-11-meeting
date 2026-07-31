import type { Database } from "@/db";
import type { CreateAuditEventInput, AuditEvent } from "@/domain/audit/types";
import {
  mapAuditEventRow,
  serializeAuditEvent,
  type AuditEventRow,
} from "@/persistence/sqlite/mappers";

export class AuditEventRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): AuditEvent | undefined {
    const row = this.db
      .prepare("SELECT * FROM audit_events WHERE id = ?")
      .get(id) as AuditEventRow | undefined;
    return row ? mapAuditEventRow(row) : undefined;
  }

  findByIdempotencyKey(idempotencyKey: string): AuditEvent | undefined {
    const row = this.db
      .prepare(
        "SELECT * FROM audit_events WHERE idempotency_key = ? ORDER BY created_at, id LIMIT 1",
      )
      .get(idempotencyKey) as AuditEventRow | undefined;
    return row ? mapAuditEventRow(row) : undefined;
  }

  list(
    filters: {
      targetType?: string;
      targetId?: string;
      eventType?: string;
      idempotencyKey?: string | null;
    } = {},
  ): AuditEvent[] {
    const conditions: string[] = [];
    const params: Array<string | null> = [];
    if (filters.targetType) {
      conditions.push("target_type = ?");
      params.push(filters.targetType);
    }
    if (filters.targetId) {
      conditions.push("target_id = ?");
      params.push(filters.targetId);
    }
    if (filters.eventType) {
      conditions.push("event_type = ?");
      params.push(filters.eventType);
    }
    if (filters.idempotencyKey !== undefined) {
      conditions.push("idempotency_key = ?");
      params.push(filters.idempotencyKey ?? null);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return (
      this.db
        .prepare(`SELECT * FROM audit_events ${where} ORDER BY created_at, id`)
        .all(...params) as AuditEventRow[]
    ).map((row) => mapAuditEventRow(row));
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
