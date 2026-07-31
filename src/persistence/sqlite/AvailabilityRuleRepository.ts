import type { Database } from '@/db';
import type { CreateAvailabilityRuleInput, AvailabilityRule } from '@/domain/rule/types';
import {
  mapAvailabilityRuleRow,
  serializeAvailabilityRule,
  type AvailabilityRuleRow,
} from '@/persistence/sqlite/mappers';

export class AvailabilityRuleRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): AvailabilityRule | undefined {
    const row = this.db.prepare('SELECT * FROM availability_rules WHERE id = ?').get(id) as AvailabilityRuleRow | undefined;
    return row ? mapAvailabilityRuleRow(row) : undefined;
  }

  list(): AvailabilityRule[] {
    return (this.db.prepare('SELECT * FROM availability_rules ORDER BY created_at, id').all() as AvailabilityRuleRow[]).map((row) =>
      mapAvailabilityRuleRow(row),
    );
  }

  upsert(input: CreateAvailabilityRuleInput): AvailabilityRule {
    const now = new Date().toISOString();
    const existing = this.db.prepare('SELECT created_at AS createdAt FROM availability_rules WHERE id = ?').get(input.id) as
      | { createdAt: string }
      | undefined;
    const row = serializeAvailabilityRule({
      ...input,
      createdAt: input.createdAt ?? existing?.createdAt,
      updatedAt: input.updatedAt ?? now,
    });

    this.db
      .prepare(
        `INSERT INTO availability_rules (
          id, target_type, target_id, rule_type, reason, enabled, is_system, recurrence, start, end, version, created_at, updated_at
        ) VALUES (
          @id, @target_type, @target_id, @rule_type, @reason, @enabled, @is_system, @recurrence, @start, @end, @version, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          target_type = excluded.target_type,
          target_id = excluded.target_id,
          rule_type = excluded.rule_type,
          reason = excluded.reason,
          enabled = excluded.enabled,
          is_system = excluded.is_system,
          recurrence = excluded.recurrence,
          start = excluded.start,
          end = excluded.end,
          version = excluded.version,
          updated_at = excluded.updated_at`,
      )
      .run(row);

    return this.findById(input.id) as AvailabilityRule;
  }
}
