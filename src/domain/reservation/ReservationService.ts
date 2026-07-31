/**
 * Reservation lifecycle service for RFC-0001 T4.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * Coordinates create, query, update, cancel, idempotent submit, and administrator force adjustment. Resource checks and
 * writes run inside one SQLite immediate transaction so overlapping reservations cannot be committed.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '@/db';
import { AppError, type AppErrorCode, type ConflictDetail } from '@/errors/AppError';
import { AuditService, type AuditContext } from '@/domain/audit/AuditService';
import type { AuditEvent } from '@/domain/audit/types';
import { AvailabilityService } from '@/domain/availability';
import { parseUtcInterval } from '@/domain/availability/interval';
import type { ReservationConflictDetail } from '@/domain/availability/types';
import { AuditEventRepository } from '@/persistence/sqlite/AuditEventRepository';
import { ReservationRepository } from '@/persistence/sqlite/ReservationRepository';
import { RoomRepository } from '@/persistence/sqlite/RoomRepository';
import type {
  CancelReservationInput,
  CreateReservationInput,
  ForceAdjustReservationInput,
  Reservation,
  ReservationResourceSnapshot,
  ReservationWithResources,
  UpdateReservationInput,
} from './types';

export interface ReservationListFilters {
  from?: string;
  to?: string;
  roomId?: string;
  status?: 'active' | 'cancelled' | string;
}

export interface ForceAdjustReservationResult {
  reservation: ReservationWithResources;
  resources: ReservationResourceSnapshot[];
  cancelledReservations: ReservationWithResources[];
  conflicts: ReservationConflictDetail[];
  auditEventIds: string[];
}

export class ReservationService {
  private readonly auditRepository: AuditEventRepository;
  private readonly auditService: AuditService;
  private readonly availabilityService: AvailabilityService;
  private readonly roomRepository: RoomRepository;
  private readonly reservationRepository: ReservationRepository;

  constructor(
    private readonly db: Database,
    reservationRepository = new ReservationRepository(db),
    auditRepository = new AuditEventRepository(db),
  ) {
    this.reservationRepository = reservationRepository;
    this.auditRepository = auditRepository;
    this.auditService = new AuditService(auditRepository);
    this.availabilityService = new AvailabilityService(db);
    this.roomRepository = new RoomRepository(db);
  }

  list(filters: ReservationListFilters = {}): ReservationWithResources[] {
    return this.reservationRepository.list(filters).map((reservation) => this.withResources(reservation));
  }

  findById(id: string): ReservationWithResources | undefined {
    const reservation = this.reservationRepository.findById(id);
    return reservation ? this.withResources(reservation) : undefined;
  }

  create(input: CreateReservationInput, context: AuditContext = {}): ReservationWithResources {
    return this.runInTransaction(() => {
      const normalized = this.prepareCreateInput({ ...input, idempotencyKey: context.idempotencyKey ?? input.idempotencyKey ?? null });
      const existingByIdempotencyKey = normalized.idempotencyKey
        ? this.reservationRepository.findByIdempotencyKey(normalized.idempotencyKey)
        : undefined;
      if (existingByIdempotencyKey) {
        this.throwIfIdempotencyKeyConflicts(normalized, existingByIdempotencyKey);
        return this.withResources(existingByIdempotencyKey);
      }
      if (normalized.id && this.reservationRepository.findById(normalized.id)) {
        throw new AppError('VALIDATION_ERROR', `预约已存在: ${normalized.id}`);
      }

      const check = this.availabilityService.checkAvailability({
        roomId: normalized.roomId,
        start: normalized.start,
        end: normalized.end,
      });
      this.throwIfUnavailable(check, '创建预约失败');

      const reservation = this.reservationRepository.upsert(normalized);
      this.upsertResourceSnapshots(reservation.id, normalized.roomId, normalized.start, normalized.end, normalized.version);
      this.recordAudit(
        'reservation.created',
        reservation.id,
        undefined,
        toAuditReservation(reservation),
        { ...context, idempotencyKey: context.idempotencyKey ?? normalized.idempotencyKey ?? null },
      );
      return this.withResources(reservation);
    });
  }

  update(id: string, patch: UpdateReservationInput, context: AuditContext = {}): ReservationWithResources {
    return this.runInTransaction(() => {
      const existing = this.reservationRepository.findById(id);
      if (!existing) {
        throw new AppError('NOT_FOUND', `预约不存在: ${id}`, { conflicts: [{ type: 'reservation', id, name: id }] });
      }
      if (existing.status === 'cancelled') {
        throw new AppError('VALIDATION_ERROR', '已取消预约不可修改');
      }
      if (patch.version !== undefined && patch.version !== existing.version) {
        throw new AppError('VERSION_CONFLICT', `预约版本已过期: ${id}`, {
          conflicts: [{ type: 'version', id, name: existing.title, reason: `当前版本为 ${existing.version}` }],
        });
      }
      const idempotencyKey = context.idempotencyKey ?? null;
      if (this.findCompletedAudit('reservation.updated', id, idempotencyKey)) {
        return this.withResources(this.reservationRepository.findById(id) as Reservation);
      }

      const next = this.prepareUpdateInput(existing, patch);
      const check = this.availabilityService.checkAvailability({
        roomId: next.roomId,
        start: next.start,
        end: next.end,
        excludeReservationId: next.id,
      });
      this.throwIfUnavailable(check, '修改预约失败');

      const updated = this.reservationRepository.update(next, existing.version);
      this.reservationRepository.deleteResourceSnapshots(id);
      this.upsertResourceSnapshots(updated.id, updated.roomId, updated.start, updated.end, updated.version);
      this.recordAudit(
        'reservation.updated',
        updated.id,
        toAuditReservation(existing),
        toAuditReservation(updated),
        { ...context, idempotencyKey },
      );
      return this.withResources(updated);
    });
  }

  cancel(id: string, input: CancelReservationInput = {}, context: AuditContext = {}): ReservationWithResources {
    return this.runInTransaction(() => {
      const existing = this.reservationRepository.findById(id);
      if (!existing) {
        throw new AppError('NOT_FOUND', `预约不存在: ${id}`, { conflicts: [{ type: 'reservation', id, name: id }] });
      }
      const idempotencyKey = input.idempotencyKey ?? context.idempotencyKey ?? null;
      if (existing.status === 'cancelled') {
        if (idempotencyKey && existing.idempotencyKey && idempotencyKey !== existing.idempotencyKey) {
          throw new AppError('IDEMPOTENCY_CONFLICT', '取消预约的幂等键与已有记录不一致', {
            conflicts: [{ type: 'reservation', id: existing.id, name: existing.title }],
          });
        }
        return this.withResources(existing);
      }
      if (input.version !== undefined && input.version !== existing.version) {
        throw new AppError('VERSION_CONFLICT', `预约版本已过期: ${id}`, {
          conflicts: [{ type: 'version', id, name: existing.title, reason: `当前版本为 ${existing.version}` }],
        });
      }
      if (this.findCompletedAudit('reservation.cancelled', id, idempotencyKey)) {
        return this.withResources(this.reservationRepository.findById(id) as Reservation);
      }

      const now = new Date().toISOString();
      const updated = this.reservationRepository.update(
        {
          ...existing,
          status: 'cancelled',
          version: existing.version + 1,
          cancelledAt: now,
          cancelledReason: input.reason ?? null,
          idempotencyKey: idempotencyKey ?? existing.idempotencyKey ?? null,
          updatedAt: now,
          createdAt: existing.createdAt,
        },
        existing.version,
      );
      this.reservationRepository.deleteResourceSnapshots(id);
      this.recordAudit(
        'reservation.cancelled',
        updated.id,
        toAuditReservation(existing),
        toAuditReservation(updated),
        { ...context, reason: context.reason ?? input.reason ?? '取消预约', idempotencyKey },
      );
      return this.withResources(updated);
    });
  }

  forceAdjust(id: string, input: ForceAdjustReservationInput, context: AuditContext = {}): ForceAdjustReservationResult {
    if (!input.force) {
      throw new AppError('FORCE_REASON_REQUIRED', '强制调整必须显式设置 force=true');
    }
    if (!input.reason.trim()) {
      throw new AppError('FORCE_REASON_REQUIRED', '强制调整必须提供原因');
    }

    try {
      return this.runInTransaction(() => {
        const existing = this.reservationRepository.findById(id);
        if (!existing) {
          throw new AppError('NOT_FOUND', `预约不存在: ${id}`, { conflicts: [{ type: 'reservation', id, name: id }] });
        }
        if (existing.status === 'cancelled') {
          throw new AppError('VALIDATION_ERROR', '已取消预约不可强制调整');
        }
        if (input.version !== undefined && input.version !== existing.version) {
          throw new AppError('VERSION_CONFLICT', `预约版本已过期: ${id}`, {
            conflicts: [{ type: 'version', id, name: existing.title, reason: `当前版本为 ${existing.version}` }],
          });
        }
        const idempotencyKey = input.idempotencyKey ?? context.idempotencyKey ?? null;
        const previousAudit = this.findCompletedAudit('reservation.force_adjusted', id, idempotencyKey);
        if (previousAudit) {
          return this.forceAdjustResultFromAudit(previousAudit, idempotencyKey);
        }

        const normalized = this.prepareForceInput(existing, input);
        const check = this.availabilityService.checkAvailability({
          roomId: normalized.roomId,
          start: normalized.start,
          end: normalized.end,
          excludeReservationId: existing.id,
        });
        const conflicts = uniqueReservationConflicts(check.reservationConflicts);
        const cancelledReservations = this.cancelConflictReservations(conflicts, input.reason);
        const now = new Date().toISOString();
        const updated = this.reservationRepository.update(
          {
            ...existing,
            ...normalized,
            version: existing.version + 1,
            updatedAt: now,
            createdAt: existing.createdAt,
          },
          existing.version,
        );
        this.reservationRepository.deleteResourceSnapshots(updated.id);
        this.upsertResourceSnapshots(updated.id, updated.roomId, updated.start, updated.end, updated.version);
        const postCheck = this.availabilityService.checkAvailability({
          roomId: updated.roomId,
          start: updated.start,
          end: updated.end,
          excludeReservationId: updated.id,
        });
        if (!postCheck.isAvailable) {
          throw new AppError('DATABASE_ERROR', '强制调整后仍存在资源冲突，事务已回滚');
        }

        const targetAudit = this.recordAudit(
          'reservation.force_adjusted',
          updated.id,
          toAuditReservation(existing),
          toAuditReservation(updated),
          { ...context, reason: input.reason, idempotencyKey },
          forceAdjustAuditId(updated.id, idempotencyKey),
        );
        const auditEventIds = [targetAudit.id];
        for (const reservation of cancelledReservations) {
          auditEventIds.push(
            this.recordAudit(
              'reservation.cancelled_by_force',
              reservation.id,
              toAuditReservation(reservation),
              toAuditReservation({
                ...reservation,
                status: 'cancelled',
                cancelledAt: now,
                cancelledReason: input.reason,
              }),
              { ...context, reason: input.reason, idempotencyKey },
            ).id,
          );
        }
        return {
          reservation: this.withResources(updated),
          resources: this.reservationRepository.resourceSnapshotsForReservation(updated.id),
          cancelledReservations: cancelledReservations.map((reservation) => this.withResources(reservation)),
          conflicts,
          auditEventIds,
        };
      });
    } catch (error) {
      if (isUniqueConstraint(error) && input.idempotencyKey) {
        const previousAudit = this.findCompletedAudit('reservation.force_adjusted', id, input.idempotencyKey);
        if (previousAudit) {
          return this.forceAdjustResultFromAudit(previousAudit, input.idempotencyKey);
        }
      }
      throw error;
    }
  }

  private withResources(reservation: Reservation): ReservationWithResources {
    return {
      ...reservation,
      resources: this.reservationRepository.resourceSnapshotsForReservation(reservation.id),
    };
  }

  private runInTransaction<T>(fn: () => T): T {
    this.db.prepare('BEGIN IMMEDIATE').run();
    let committed = false;
    try {
      const result = fn();
      committed = true;
      return result;
    } finally {
      if (committed) {
        this.db.prepare('COMMIT').run();
      } else {
        this.db.prepare('ROLLBACK').run();
      }
    }
  }

  private prepareCreateInput(input: CreateReservationInput): Required<CreateReservationInput> & { id: string } {
    const id = input.id ?? `reservation-${randomUUID()}`;
    const now = new Date().toISOString();
    const reservation: Required<CreateReservationInput> & { id: string } = {
      id,
      title: input.title,
      description: input.description ?? '',
      roomId: input.roomId,
      start: input.start,
      end: input.end,
      status: input.status ?? 'active',
      idempotencyKey: input.idempotencyKey ?? null,
      version: input.version ?? 1,
      createdAt: input.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      cancelledAt: input.cancelledAt ?? null,
      cancelledReason: input.cancelledReason ?? null,
    };
    validateReservationInput(reservation);
    return reservation;
  }

  private prepareUpdateInput(existing: Reservation, patch: UpdateReservationInput): CreateReservationInput {
    const next = {
      ...existing,
      ...patch,
      version: existing.version + 1,
      cancelledAt: existing.cancelledAt ?? null,
      cancelledReason: existing.cancelledReason ?? null,
    };
    validateReservationInput(next);
    return next;
  }

  private prepareForceInput(existing: Reservation, input: ForceAdjustReservationInput): CreateReservationInput {
    const now = new Date().toISOString();
    const next = {
      ...existing,
      roomId: input.roomId,
      start: input.start,
      end: input.end,
      version: existing.version + 1,
      updatedAt: now,
    };
    validateReservationInput(next);
    return next;
  }

  private upsertResourceSnapshots(reservationId: string, roomId: string, start: string, end: string, version: number): void {
    const room = this.roomRepository.listWithResources().find((candidate) => candidate.id === roomId);
    if (!room) {
      throw new AppError('NOT_FOUND', `房间不存在: ${roomId}`, { conflicts: [{ type: 'room', id: roomId, name: roomId }] });
    }
    const now = new Date().toISOString();
    this.reservationRepository.upsertResourceSnapshots(
      room.resources.map((resource) => ({
        reservationId,
        resourceId: resource.id,
        roomId,
        start,
        end,
        version,
        createdAt: now,
        updatedAt: now,
      })),
    );
  }

  private cancelConflictReservations(conflicts: ReservationConflictDetail[], reason: string): Reservation[] {
    const cancelled: Reservation[] = [];
    const seen = new Set<string>();
    for (const conflict of conflicts) {
      if (seen.has(conflict.reservationId)) {
        continue;
      }
      seen.add(conflict.reservationId);
      const reservation = this.reservationRepository.findById(conflict.reservationId);
      if (!reservation || reservation.status === 'cancelled') {
        continue;
      }
      const now = new Date().toISOString();
      const updated = this.reservationRepository.update(
        {
          ...reservation,
          status: 'cancelled',
          version: reservation.version + 1,
          cancelledAt: now,
          cancelledReason: reason,
          updatedAt: now,
          createdAt: reservation.createdAt,
        },
        reservation.version,
      );
      this.reservationRepository.deleteResourceSnapshots(reservation.id);
      cancelled.push(updated);
    }
    return cancelled;
  }

  private throwIfUnavailable(check: ReturnType<AvailabilityService['checkAvailability']>, prefix: string): void {
    if (check.isAvailable) {
      return;
    }
    throw new AppError(codeForConflicts(check.conflicts), `${prefix}: ${messageForConflicts(check.conflicts)}`, {
      conflicts: check.conflicts,
    });
  }

  private findCompletedAudit(
    eventType: string,
    targetId: string,
    idempotencyKey: string | null | undefined,
  ): AuditEvent | undefined {
    if (!idempotencyKey) {
      return undefined;
    }
    return this.auditRepository.list({ eventType, targetId, idempotencyKey })[0];
  }

  private recordAudit(
    eventType: string,
    targetId: string,
    before: unknown,
    after: unknown,
    context: AuditContext,
    auditId = `audit-${randomUUID()}`,
  ): AuditEvent {
    return this.auditService.record(
      {
        id: auditId,
        eventType,
        targetType: 'reservation',
        targetId,
        before,
        after,
      },
      context,
    );
  }

  private forceAdjustResultFromAudit(previousAudit: AuditEvent, idempotencyKey: string | null): ForceAdjustReservationResult {
    const reservation = this.reservationRepository.findById(previousAudit.targetId);
    if (!reservation) {
      throw new AppError('NOT_FOUND', `预约不存在: ${previousAudit.targetId}`, {
        conflicts: [{ type: 'reservation', id: previousAudit.targetId, name: previousAudit.targetId }],
      });
    }
    const cancelledAudits = this.auditRepository
      .list({ eventType: 'reservation.cancelled_by_force', idempotencyKey })
      .filter((audit) => audit.targetId !== previousAudit.targetId);
    const cancelledReservations = cancelledAudits
      .map((audit) => this.reservationRepository.findById(audit.targetId))
      .filter((reservation): reservation is Reservation => Boolean(reservation))
      .map((reservation) => this.withResources(reservation));

    return {
      reservation: this.withResources(reservation),
      resources: this.reservationRepository.resourceSnapshotsForReservation(reservation.id),
      cancelledReservations,
      conflicts: buildConflictsFromCancelled(this.withResources(reservation), cancelledReservations),
      auditEventIds: [previousAudit.id, ...cancelledAudits.map((audit) => audit.id)],
    };
  }

  private throwIfIdempotencyKeyConflicts(input: Required<CreateReservationInput> & { id: string }, existing: Reservation): void {
    if (input.id && input.id !== existing.id) {
      throw new AppError('IDEMPOTENCY_CONFLICT', `幂等键已被其他预约使用: ${input.idempotencyKey}`, {
        conflicts: [
          {
            type: 'reservation',
            id: existing.id,
            name: existing.title,
            reason: `该幂等键已创建预约 ${existing.id}`,
          },
        ],
      });
    }
  }
}

function validateReservationInput(input: {
  id: string;
  title: string;
  description: string;
  roomId: string;
  start: string;
  end: string;
  status: string;
  version: number;
}): void {
  if (!input.id || !input.title.trim() || !input.roomId) {
    throw new AppError('VALIDATION_ERROR', '预约标题和房间不能为空');
  }
  if (!['active', 'cancelled'].includes(input.status)) {
    throw new AppError('VALIDATION_ERROR', `不支持的预约状态: ${input.status}`);
  }
  if (!Number.isInteger(input.version) || input.version <= 0) {
    throw new AppError('VALIDATION_ERROR', '预约版本必须为正整数');
  }
  try {
    parseUtcInterval(input.start, input.end);
  } catch (error) {
    throw new AppError('VALIDATION_ERROR', `预约时间无效: ${(error as Error).message}`);
  }
}

function codeForConflicts(conflicts: ConflictDetail[]): AppErrorCode {
  if (conflicts.some((conflict) => conflict.type === 'reservation')) {
    return 'RESERVATION_CONFLICT';
  }
  if (conflicts.some((conflict) => conflict.type === 'rule')) {
    return 'RULE_BLOCKED';
  }
  if (conflicts.some((conflict) => conflict.type === 'time')) {
    return 'OUTSIDE_OPEN_HOURS';
  }
  return 'VALIDATION_ERROR';
}

function messageForConflicts(conflicts: ConflictDetail[]): string {
  if (conflicts.length === 0) {
    return '资源不可用';
  }
  const first = conflicts[0];
  const when = first.start && first.end ? ` ${first.start}–${first.end}` : '';
  return `${first.reason ?? '资源不可用'}${when}`;
}

function toAuditReservation(reservation: Reservation): Record<string, unknown> {
  return {
    id: reservation.id,
    title: reservation.title,
    description: reservation.description,
    roomId: reservation.roomId,
    start: reservation.start,
    end: reservation.end,
    status: reservation.status,
    version: reservation.version,
    cancelledAt: reservation.cancelledAt,
    cancelledReason: reservation.cancelledReason,
  };
}

function forceAdjustAuditId(reservationId: string, idempotencyKey: string | null): string | undefined {
  if (!idempotencyKey) {
    return undefined;
  }
  const digest = createHash('sha256').update(`${reservationId}:${idempotencyKey}`).digest('hex').slice(0, 16);
  return `audit-force-${digest}`;
}

function buildConflictsFromCancelled(
  target: ReservationWithResources,
  cancelledReservations: ReservationWithResources[],
): ReservationConflictDetail[] {
  const conflicts: ReservationConflictDetail[] = [];
  const seen = new Set<string>();
  for (const cancelled of cancelledReservations) {
    for (const snapshot of cancelled.resources) {
      for (const targetSnapshot of target.resources) {
        if (snapshot.resourceId !== targetSnapshot.resourceId) {
          continue;
        }
        if (!intervalsOverlapForStrings(snapshot.start, snapshot.end, targetSnapshot.start, targetSnapshot.end)) {
          continue;
        }
        const key = `${cancelled.id}:${snapshot.resourceId}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const overlap = overlapForStrings(snapshot.start, snapshot.end, targetSnapshot.start, targetSnapshot.end);
        conflicts.push({
          reservationId: cancelled.id,
          roomId: snapshot.roomId,
          roomName: snapshot.roomId,
          resourceId: snapshot.resourceId,
          resourceName: snapshot.resourceId,
          title: cancelled.title,
          start: overlap.start,
          end: overlap.end,
          reason: '同一物理资源存在有效预约',
        });
      }
    }
  }
  return conflicts;
}

function intervalsOverlapForStrings(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): boolean {
  const left = parseUtcInterval(leftStart, leftEnd);
  const right = parseUtcInterval(rightStart, rightEnd);
  return left.start < right.end && right.start < left.end;
}

function overlapForStrings(
  leftStart: string,
  leftEnd: string,
  rightStart: string,
  rightEnd: string,
): { start: string; end: string } {
  const left = parseUtcInterval(leftStart, leftEnd);
  const right = parseUtcInterval(rightStart, rightEnd);
  const start = left.start > right.start ? left.start : right.start;
  const end = left.end < right.end ? left.end : right.end;
  return { start: start.toISOString(), end: end.toISOString() };
}

function isUniqueConstraint(error: unknown): boolean {
  return error instanceof Error && /SQLITE_CONSTRAINT_UNIQUE|SQLITE_CONSTRAINT_PRIMARYKEY/.test(error.message);
}

function uniqueReservationConflicts(conflicts: ReservationConflictDetail[]): ReservationConflictDetail[] {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    if (seen.has(conflict.reservationId)) {
      return false;
    }
    seen.add(conflict.reservationId);
    return true;
  });
}
