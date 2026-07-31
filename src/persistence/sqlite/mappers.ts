import type { Room, CreateRoomInput } from '@/domain/room/types';
import type { Resource, CreateResourceInput } from '@/domain/resource/types';
import type { AvailabilityRule, CreateAvailabilityRuleInput } from '@/domain/rule/types';
import type { Reservation, CreateReservationInput, ReservationResourceSnapshot } from '@/domain/reservation/types';
import type { AuditEvent, CreateAuditEventInput } from '@/domain/audit/types';

export interface RoomRow {
  id: string;
  name: string;
  type: string;
  capacity: number;
  location: string;
  equipment_json: string;
  enabled: number;
  open_start: string;
  open_end: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ResourceRow {
  id: string;
  name: string;
  type: string;
  enabled: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface RoomResourceRow {
  room_id: string;
  resource_id: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ReservationRow {
  id: string;
  title: string;
  description: string;
  room_id: string;
  start: string;
  end: string;
  status: string;
  idempotency_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancelled_reason: string | null;
}

export interface ReservationResourceRow {
  reservation_id: string;
  resource_id: string;
  room_id: string;
  start: string;
  end: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityRuleRow {
  id: string;
  target_type: string;
  target_id: string;
  rule_type: string;
  reason: string;
  enabled: number;
  recurrence: string | null;
  start: string;
  end: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface AuditEventRow {
  id: string;
  event_type: string;
  actor: string;
  reason: string;
  target_type: string;
  target_id: string;
  before_json: string | null;
  after_json: string | null;
  idempotency_key: string | null;
  created_at: string;
}

export function mapRoomRow(row: RoomRow): Room {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    capacity: row.capacity,
    location: row.location,
    equipment: JSON.parse(row.equipment_json) as string[],
    enabled: row.enabled === 1,
    openStart: row.open_start,
    openEnd: row.open_end,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapResourceRow(row: ResourceRow): Resource {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    enabled: row.enabled === 1,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapRoomResourceRow(row: RoomResourceRow) {
  return {
    roomId: row.room_id,
    resourceId: row.resource_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAvailabilityRuleRow(row: AvailabilityRuleRow): AvailabilityRule {
  return {
    id: row.id,
    targetType: row.target_type as AvailabilityRule['targetType'],
    targetId: row.target_id,
    ruleType: row.rule_type as AvailabilityRule['ruleType'],
    reason: row.reason,
    enabled: row.enabled === 1,
    recurrence: row.recurrence ?? undefined,
    start: row.start,
    end: row.end,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapReservationRow(row: ReservationRow): Reservation {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    roomId: row.room_id,
    start: row.start,
    end: row.end,
    status: row.status as Reservation['status'],
    idempotencyKey: row.idempotency_key,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at,
    cancelledReason: row.cancelled_reason,
  };
}

export function mapReservationResourceRow(row: ReservationResourceRow): ReservationResourceSnapshot {
  return {
    reservationId: row.reservation_id,
    resourceId: row.resource_id,
    roomId: row.room_id,
    start: row.start,
    end: row.end,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapAuditEventRow(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    actor: row.actor,
    reason: row.reason,
    targetType: row.target_type,
    targetId: row.target_id,
    before: row.before_json ? JSON.parse(row.before_json) : undefined,
    after: row.after_json ? JSON.parse(row.after_json) : undefined,
    idempotencyKey: row.idempotency_key,
    createdAt: row.created_at,
  };
}

export function serializeRoom(row: CreateRoomInput) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    capacity: row.capacity,
    location: row.location,
    equipment_json: JSON.stringify(row.equipment ?? []),
    enabled: row.enabled === false ? 0 : 1,
    open_start: row.openStart ?? '08:00',
    open_end: row.openEnd ?? '22:00',
    version: row.version ?? 1,
    created_at: row.createdAt ?? new Date().toISOString(),
    updated_at: row.updatedAt ?? new Date().toISOString(),
  };
}

export function serializeResource(row: CreateResourceInput) {
  return {
    id: row.id,
    name: row.name,
    type: row.type ?? 'physical-space',
    enabled: row.enabled === false ? 0 : 1,
    version: row.version ?? 1,
    created_at: row.createdAt ?? new Date().toISOString(),
    updated_at: row.updatedAt ?? new Date().toISOString(),
  };
}

export function serializeAvailabilityRule(row: CreateAvailabilityRuleInput) {
  return {
    id: row.id,
    target_type: row.targetType,
    target_id: row.targetId,
    rule_type: row.ruleType,
    reason: row.reason,
    enabled: row.enabled === false ? 0 : 1,
    recurrence: row.recurrence ?? null,
    start: row.start,
    end: row.end,
    version: row.version ?? 1,
    created_at: row.createdAt ?? new Date().toISOString(),
    updated_at: row.updatedAt ?? new Date().toISOString(),
  };
}

export function serializeReservation(row: CreateReservationInput) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    room_id: row.roomId,
    start: row.start,
    end: row.end,
    status: row.status ?? 'active',
    idempotency_key: row.idempotencyKey ?? null,
    version: row.version ?? 1,
    created_at: row.createdAt ?? new Date().toISOString(),
    updated_at: row.updatedAt ?? new Date().toISOString(),
    cancelled_at: row.cancelledAt ?? null,
    cancelled_reason: row.cancelledReason ?? null,
  };
}

export function serializeAuditEvent(row: CreateAuditEventInput) {
  return {
    id: row.id,
    event_type: row.eventType,
    actor: row.actor,
    reason: row.reason ?? '',
    target_type: row.targetType,
    target_id: row.targetId,
    before_json: row.before ? JSON.stringify(row.before) : null,
    after_json: row.after ? JSON.stringify(row.after) : null,
    idempotency_key: row.idempotencyKey ?? null,
    created_at: row.createdAt ?? new Date().toISOString(),
  };
}
