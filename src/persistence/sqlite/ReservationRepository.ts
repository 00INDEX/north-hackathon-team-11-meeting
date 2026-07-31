import type { Database } from '@/db';
import type { CreateReservationInput, Reservation, ReservationResourceSnapshot } from '@/domain/reservation/types';
import {
  mapReservationResourceRow,
  mapReservationRow,
  serializeReservation,
  type ReservationResourceRow,
  type ReservationRow,
} from '@/persistence/sqlite/mappers';

export class ReservationRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Reservation | undefined {
    const row = this.db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) as ReservationRow | undefined;
    return row ? mapReservationRow(row) : undefined;
  }

  findByIdempotencyKey(idempotencyKey: string): Reservation | undefined {
    const row = this.db
      .prepare('SELECT * FROM reservations WHERE idempotency_key = ?')
      .get(idempotencyKey) as ReservationRow | undefined;
    return row ? mapReservationRow(row) : undefined;
  }

  list(): Reservation[] {
    return (this.db.prepare('SELECT * FROM reservations ORDER BY created_at, id').all() as ReservationRow[]).map((row) =>
      mapReservationRow(row),
    );
  }

  upsert(input: CreateReservationInput): Reservation {
    const now = new Date().toISOString();
    const exists = Boolean(this.db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(input.id));
    const row = serializeReservation({
      ...input,
      createdAt: input.createdAt ?? (exists ? now : undefined),
      updatedAt: input.updatedAt ?? now,
    });

    this.db
      .prepare(
        `INSERT INTO reservations (
          id, title, description, room_id, start, end, status, idempotency_key, version, created_at, updated_at, cancelled_at, cancelled_reason
        ) VALUES (
          @id, @title, @description, @room_id, @start, @end, @status, @idempotency_key, @version, @created_at, @updated_at, @cancelled_at, @cancelled_reason
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          room_id = excluded.room_id,
          start = excluded.start,
          end = excluded.end,
          status = excluded.status,
          idempotency_key = excluded.idempotency_key,
          version = excluded.version,
          updated_at = excluded.updated_at,
          cancelled_at = excluded.cancelled_at,
          cancelled_reason = excluded.cancelled_reason`,
      )
      .run(row);

    return this.findById(input.id) as Reservation;
  }

  upsertResourceSnapshot(input: ReservationResourceSnapshot): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO reservation_resources (
          reservation_id, resource_id, room_id, start, end, version, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(reservation_id, resource_id) DO UPDATE SET
          room_id = excluded.room_id,
          start = excluded.start,
          end = excluded.end,
          version = excluded.version,
          updated_at = excluded.updated_at`,
      )
      .run(
        input.reservationId,
        input.resourceId,
        input.roomId,
        input.start,
        input.end,
        input.version,
        input.createdAt ?? now,
        input.updatedAt ?? now,
      );
  }

  resourceSnapshotsForReservation(reservationId: string): ReservationResourceSnapshot[] {
    return (
      this.db
        .prepare('SELECT * FROM reservation_resources WHERE reservation_id = ? ORDER BY resource_id')
        .all(reservationId) as ReservationResourceRow[]
    ).map((row) => mapReservationResourceRow(row));
  }
}
