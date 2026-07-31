/**
 * Resource persistence boundary.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * Stores physical resources that reservations occupy exclusively.
 */
import type { Database } from '@/db';
import type { CreateResourceInput, Resource } from '@/domain/resource/types';
import { mapResourceRow, serializeResource, type ResourceRow } from '@/persistence/sqlite/mappers';

export class ResourceRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Resource | undefined {
    const row = this.db.prepare('SELECT * FROM resources WHERE id = ?').get(id) as ResourceRow | undefined;
    return row ? mapResourceRow(row) : undefined;
  }

  list(): Resource[] {
    return (this.db.prepare('SELECT * FROM resources ORDER BY created_at, id').all() as ResourceRow[]).map((row) =>
      mapResourceRow(row),
    );
  }

  upsertMany(input: CreateResourceInput[]): Resource[] {
    for (const resource of input) {
      const now = new Date().toISOString();
      const existing = this.db.prepare('SELECT created_at AS createdAt FROM resources WHERE id = ?').get(resource.id) as
        | { createdAt: string }
        | undefined;
      const row = serializeResource({
        ...resource,
        createdAt: resource.createdAt ?? existing?.createdAt,
        updatedAt: resource.updatedAt ?? now,
      });

      this.db
        .prepare(
          `INSERT INTO resources (
            id, name, type, enabled, version, created_at, updated_at
          ) VALUES (
            @id, @name, @type, @enabled, @version, @created_at, @updated_at
          )
          ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            type = excluded.type,
            enabled = excluded.enabled,
            version = excluded.version,
            updated_at = excluded.updated_at`,
        )
        .run(row);
    }

    return this.list();
  }
}
