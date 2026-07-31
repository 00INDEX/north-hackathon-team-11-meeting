import { AppError } from "@/errors/AppError";
import type { Database } from "@/db";
import type {
  CreateReservationInput,
  Reservation,
  ReservationResourceSnapshot,
} from "@/domain/reservation/types";
import {
  mapReservationResourceRow,
  mapReservationRow,
  serializeReservation,
  type ReservationResourceRow,
  type ReservationRow,
} from "@/persistence/sqlite/mappers";

export interface ReservationListFilters {
  from?: string;
  to?: string;
  roomId?: string;
  status?: string;
}

export class ReservationRepository {
  constructor(private readonly db: Database) {}

  findById(id: string): Reservation | undefined {
    const row = this.db
      .prepare("SELECT * FROM reservations WHERE id = ?")
      .get(id) as ReservationRow | undefined;
    return row ? mapReservationRow(row) : undefined;
  }

  findByIdempotencyKey(idempotencyKey: string): Reservation | undefined {
    const row = this.db
      .prepare("SELECT * FROM reservations WHERE idempotency_key = ?")
      .get(idempotencyKey) as ReservationRow | undefined;
    return row ? mapReservationRow(row) : undefined;
  }

  list(filters: ReservationListFilters = {}): Reservation[] {
    const conditions: string[] = [];
    const params: string[] = [];

    if (filters.from) {
      conditions.push("start >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push("end <= ?");
      params.push(filters.to);
    }
    if (filters.roomId) {
      conditions.push("room_id = ?");
      params.push(filters.roomId);
    }
    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    return (
      this.db
        .prepare(
          `SELECT * FROM reservations ${where} ORDER BY start, created_at, id`,
        )
        .all(...params) as ReservationRow[]
    ).map((row) => mapReservationRow(row));
  }

  upsert(input: CreateReservationInput): Reservation {
    if (!input.id) {
      throw new AppError("VALIDATION_ERROR", "预约 ID 不能为空");
    }
    const now = new Date().toISOString();
    const exists = Boolean(
      this.db.prepare("SELECT 1 FROM reservations WHERE id = ?").get(input.id),
    );
    const row = serializeReservation({
      ...input,
      createdAt: input.createdAt ?? (exists ? undefined : now),
      updatedAt: input.updatedAt ?? now,
    }) as ReservationRow;

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

    return mapReservationRow(row);
  }

  update(input: CreateReservationInput, expectedVersion?: number): Reservation {
    if (!input.id) {
      throw new AppError("VALIDATION_ERROR", "预约 ID 不能为空");
    }
    const row = serializeReservation({
      ...input,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    });
    const result = this.db
      .prepare(
        `UPDATE reservations
         SET title = @title,
             description = @description,
             room_id = @room_id,
             start = @start,
             end = @end,
             status = @status,
             idempotency_key = @idempotency_key,
             version = @version,
             updated_at = @updated_at,
             cancelled_at = @cancelled_at,
             cancelled_reason = @cancelled_reason
         WHERE id = @id
           AND (@expectedVersion IS NULL OR version = @expectedVersion)`,
      )
      .run({ ...row, expectedVersion });

    if (result.changes !== 1) {
      const current = this.findById(input.id);
      throw new AppError("VERSION_CONFLICT", `预约版本已过期: ${input.id}`, {
        conflicts: current
          ? [
              {
                type: "version",
                id: current.id,
                name: current.title,
                reason: `当前版本为 ${current.version}`,
              },
            ]
          : [{ type: "reservation", id: input.id, name: input.id }],
      });
    }

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

  upsertResourceSnapshots(inputs: ReservationResourceSnapshot[]): void {
    for (const input of inputs) {
      this.upsertResourceSnapshot(input);
    }
  }

  deleteResourceSnapshots(reservationId: string): void {
    this.db
      .prepare("DELETE FROM reservation_resources WHERE reservation_id = ?")
      .run(reservationId);
  }

  resourceSnapshotsForReservation(
    reservationId: string,
  ): ReservationResourceSnapshot[] {
    return (
      this.db
        .prepare(
          "SELECT * FROM reservation_resources WHERE reservation_id = ? ORDER BY resource_id",
        )
        .all(reservationId) as ReservationResourceRow[]
    ).map((row) => mapReservationResourceRow(row));
  }
}
