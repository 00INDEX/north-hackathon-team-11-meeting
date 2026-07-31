import type { Database } from '@/db';
import {
  mapResourceRow,
  mapRoomResourceRow,
  mapRoomRow,
  serializeResource,
  serializeRoom,
  type ResourceRow,
  type RoomResourceRow,
  type RoomRow,
} from '@/persistence/sqlite/mappers';
import type { Resource, CreateResourceInput } from '@/domain/resource/types';
import type { Room, CreateRoomInput } from '@/domain/room/types';

export interface RoomWithResources extends Room {
  resources: Resource[];
}

export class RoomRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Room | undefined {
    const row = this.db.prepare('SELECT * FROM rooms WHERE id = ?').get(id) as RoomRow | undefined;
    return row ? mapRoomRow(row) : undefined;
  }

  list(): Room[] {
    return (this.db.prepare('SELECT * FROM rooms ORDER BY created_at, id').all() as RoomRow[]).map((row) =>
      mapRoomRow(row),
    );
  }

  listWithResources(): RoomWithResources[] {
    const rooms = this.list();
    const mappings = (
      this.db.prepare('SELECT * FROM room_resources ORDER BY room_id, resource_id').all() as RoomResourceRow[]
    ).map((row) => mapRoomResourceRow(row));
    const resourcesById = new Map(
      (this.db.prepare('SELECT * FROM resources ORDER BY created_at, id').all() as ResourceRow[]).map((row) => [
        mapResourceRow(row).id,
        mapResourceRow(row),
      ]),
    );

    return rooms.map((room) => ({
      ...room,
      resources: mappings
        .filter((mapping) => mapping.roomId === room.id)
        .map((mapping) => resourcesById.get(mapping.resourceId))
        .filter((resource): resource is Resource => Boolean(resource)),
    }));
  }

  upsert(input: CreateRoomInput): Room {
    const now = new Date().toISOString();
    const exists = Boolean(this.db.prepare('SELECT 1 FROM rooms WHERE id = ?').get(input.id));
    const row = serializeRoom({
      ...input,
      createdAt: input.createdAt ?? (exists ? now : undefined),
      updatedAt: input.updatedAt ?? now,
    });

    this.db
      .prepare(
        `INSERT INTO rooms (
          id, name, type, capacity, location, equipment_json, enabled, open_start, open_end, version, created_at, updated_at
        ) VALUES (
          @id, @name, @type, @capacity, @location, @equipment_json, @enabled, @open_start, @open_end, @version, @created_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          capacity = excluded.capacity,
          location = excluded.location,
          equipment_json = excluded.equipment_json,
          enabled = excluded.enabled,
          open_start = excluded.open_start,
          open_end = excluded.open_end,
          version = excluded.version,
          updated_at = excluded.updated_at`,
      )
      .run(row);

    return this.findById(input.id) as Room;
  }

  upsertResources(input: CreateResourceInput[]): Resource[] {
    for (const resource of input) {
      const now = new Date().toISOString();
      const exists = Boolean(this.db.prepare('SELECT 1 FROM resources WHERE id = ?').get(resource.id));
      const row = serializeResource({
        ...resource,
        createdAt: resource.createdAt ?? (exists ? now : undefined),
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

    return this.listResources();
  }

  listResources(): Resource[] {
    return (this.db.prepare('SELECT * FROM resources ORDER BY created_at, id').all() as ResourceRow[]).map((row) =>
      mapResourceRow(row),
    );
  }

  upsertRoomResources(roomId: string, resourceIds: string[]): void {
    const now = new Date().toISOString();
    const existing = new Set(
      (
        this.db.prepare('SELECT resource_id FROM room_resources WHERE room_id = ?').all(roomId) as Array<{
          resource_id: string;
        }>
      ).map((row) => row.resource_id),
    );

    for (const resourceId of resourceIds) {
      if (!existing.has(resourceId)) {
        this.db
          .prepare(
            `INSERT INTO room_resources (room_id, resource_id, version, created_at, updated_at)
             VALUES (?, ?, 1, ?, ?)`,
          )
          .run(roomId, resourceId, now, now);
      }
    }
  }

  replaceRoomResources(roomId: string, resourceIds: string[]): void {
    const now = new Date().toISOString();
    const desired = new Set(resourceIds);
    const existingRows = this.db
      .prepare('SELECT resource_id, created_at FROM room_resources WHERE room_id = ?')
      .all(roomId) as Array<{ resource_id: string; created_at: string }>;

    for (const row of existingRows) {
      if (!desired.has(row.resource_id)) {
        this.db.prepare('DELETE FROM room_resources WHERE room_id = ? AND resource_id = ?').run(roomId, row.resource_id);
      }
    }

    for (const resourceId of resourceIds) {
      const existing = existingRows.find((row) => row.resource_id === resourceId);
      this.db
        .prepare(
          `INSERT INTO room_resources (room_id, resource_id, version, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?)
           ON CONFLICT(room_id, resource_id) DO UPDATE SET
             version = excluded.version,
             updated_at = excluded.updated_at`,
        )
        .run(roomId, resourceId, existing?.created_at ?? now, now);
    }
  }
}
