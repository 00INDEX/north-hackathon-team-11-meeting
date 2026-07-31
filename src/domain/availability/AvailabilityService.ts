/**
 * Availability and conflict engine for RFC-0001 T3.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * Validates half-open UTC intervals, expands room-to-resource mappings, applies open-hour and blocking rules, and
 * detects reservation conflicts on physical resources before any write operation.
 */
import { AppError } from '@/errors/AppError';
import { AvailabilityRuleRepository } from '@/persistence/sqlite/AvailabilityRuleRepository';
import { ReservationRepository } from '@/persistence/sqlite/ReservationRepository';
import { RoomRepository, type RoomWithResources } from '@/persistence/sqlite/RoomRepository';
import type { Database } from '@/db';
import type { AvailabilityRule } from '@/domain/rule/types';
import { getShanghaiWeekday } from '@/time';
import {
  addLocalDateDays,
  clipInterval,
  intervalsOverlap,
  localTimeToUtc,
  parseClockMinutes,
  parseUtcInterval,
  toLocalDateKey,
  type UtcInterval,
} from './interval';
import type {
  AvailabilityQueryInput,
  AvailableRoom,
  BlockingRuleConflict,
  CalendarBlock,
  CalendarReservation,
  ConflictCheckInput,
  ConflictCheckResult,
  ReservationConflictDetail,
  RoomCalendar,
} from './types';

interface WeeklyRecurrence {
  type: 'weekly';
  weekdays: number[];
  timeStart: string;
  timeEnd: string;
}

export class AvailabilityService {
  private readonly roomRepository: RoomRepository;
  private readonly ruleRepository: AvailabilityRuleRepository;
  private readonly reservationRepository: ReservationRepository;

  constructor(
    private readonly db: Database,
    roomRepository = new RoomRepository(db),
    ruleRepository = new AvailabilityRuleRepository(db),
    reservationRepository = new ReservationRepository(db),
  ) {
    this.roomRepository = roomRepository;
    this.ruleRepository = ruleRepository;
    this.reservationRepository = reservationRepository;
  }

  validateAvailabilityRequest(input: AvailabilityQueryInput): UtcInterval {
    if (!input.start || !input.end) {
      throw new AppError('VALIDATION_ERROR', '可用性查询必须包含 start 和 end');
    }
    if (input.capacity !== undefined && (!Number.isFinite(input.capacity) || input.capacity <= 0)) {
      throw new AppError('VALIDATION_ERROR', 'capacity 必须为正数');
    }
    if (input.equipment !== undefined && !Array.isArray(input.equipment)) {
      throw new AppError('VALIDATION_ERROR', 'equipment 必须是字符串数组');
    }
    return parseUtcInterval(input.start, input.end);
  }

  checkAvailability(input: ConflictCheckInput): ConflictCheckResult {
    const interval = parseUtcInterval(input.start, input.end);
    const room = this.roomRepository.findById(input.roomId);
    if (!room) {
      throw new AppError('NOT_FOUND', `房间不存在: ${input.roomId}`, {
        conflicts: [{ type: 'room', id: input.roomId, name: input.roomId }],
      });
    }

    const roomWithResources = this.findRoomWithResources(input.roomId);
    const conflicts: ConflictCheckResult['conflicts'] = [];
    const blockingRules: BlockingRuleConflict[] = [];
    const reservationConflicts: ReservationConflictDetail[] = [];

    this.addDisabledTargetConflicts(roomWithResources, interval, conflicts);
    this.addOpenHourConflicts(roomWithResources, interval, conflicts);
    this.collectBlockingRuleConflicts(roomWithResources, interval, conflicts, blockingRules);
    this.collectReservationConflicts(roomWithResources, interval, input.excludeReservationId, conflicts, reservationConflicts);

    return {
      roomId: room.id,
      roomName: room.name,
      resources: roomWithResources.resources,
      start: interval.startIso,
      end: interval.endIso,
      conflicts,
      blockingRules,
      reservationConflicts,
      isAvailable: conflicts.length === 0,
    };
  }

  findAvailableRooms(input: AvailabilityQueryInput): AvailableRoom[] {
    const interval = this.validateAvailabilityRequest(input);
    const requestedEquipment = input.equipment ?? [];

    return this.roomRepository
      .listWithResources()
      .filter((room) => this.roomMatchesFilters(room, interval, requestedEquipment, input.capacity))
      .map((room) => ({ ...room, resources: room.resources }));
  }

  getRoomCalendar(roomId: string, from: string, to: string): RoomCalendar {
    const room = this.roomRepository.findById(roomId);
    if (!room) {
      throw new AppError('NOT_FOUND', `房间不存在: ${roomId}`, { conflicts: [{ type: 'room', id: roomId, name: roomId }] });
    }
    const interval = parseUtcInterval(from, to);
    const roomWithResources = this.findRoomWithResources(roomId);
    const reservations = this.collectCalendarReservations(roomWithResources, interval);
    const blocks = this.collectCalendarBlocks(roomWithResources, interval);

    return {
      roomId: room.id,
      roomName: room.name,
      from: interval.startIso,
      to: interval.endIso,
      reservations,
      blocks,
    };
  }

  private roomMatchesFilters(
    room: RoomWithResources,
    interval: UtcInterval,
    requestedEquipment: string[],
    requestedCapacity: number | undefined,
  ): boolean {
    if (!room.enabled || room.resources.some((resource) => !resource.enabled)) {
      return false;
    }
    if (requestedCapacity !== undefined && room.capacity > requestedCapacity) {
      return false;
    }
    if (requestedEquipment.length > 0 && !requestedEquipment.every((item) => room.equipment.includes(item))) {
      return false;
    }

    return this.checkAvailability({ roomId: room.id, start: interval.startIso, end: interval.endIso }).isAvailable;
  }

  private findRoomWithResources(roomId: string): RoomWithResources {
    const room = this.roomRepository.listWithResources().find((candidate) => candidate.id === roomId);
    if (!room) {
      throw new AppError('NOT_FOUND', `房间不存在: ${roomId}`, { conflicts: [{ type: 'room', id: roomId, name: roomId }] });
    }
    return room;
  }

  private addDisabledTargetConflicts(
    room: RoomWithResources,
    interval: UtcInterval,
    conflicts: ConflictCheckResult['conflicts'],
  ): void {
    if (!room.enabled) {
      conflicts.push({
        type: 'room',
        id: room.id,
        name: room.name,
        start: interval.startIso,
        end: interval.endIso,
        reason: '房间已禁用',
      });
    }
    for (const resource of room.resources.filter((candidate) => !candidate.enabled)) {
      conflicts.push({
        type: 'resource',
        id: resource.id,
        name: resource.name,
        start: interval.startIso,
        end: interval.endIso,
        reason: '物理资源已禁用',
      });
    }
  }

  private addOpenHourConflicts(
    room: RoomWithResources,
    interval: UtcInterval,
    conflicts: ConflictCheckResult['conflicts'],
  ): void {
    const outsideSegments = outsideOpenHoursSegments(room.openStart, room.openEnd, interval);
    for (const segment of outsideSegments) {
      conflicts.push({
        type: 'time',
        id: room.id,
        name: room.name,
        start: segment.startIso,
        end: segment.endIso,
        reason: `房间开放时段为 ${room.openStart}–${room.openEnd}`,
      });
    }
  }

  private collectBlockingRuleConflicts(
    room: RoomWithResources,
    interval: UtcInterval,
    conflicts: ConflictCheckResult['conflicts'],
    blockingRules: BlockingRuleConflict[],
  ): void {
    for (const rule of this.enabledRulesForTargets(room)) {
      for (const blocked of this.ruleBlockingIntervals(rule, interval)) {
        const detail = {
          type: 'rule',
          id: rule.id,
          name: blocked.targetName,
          start: blocked.start,
          end: blocked.end,
          reason: blocked.reason,
        } as const;
        conflicts.push(detail);
        blockingRules.push(blocked);
      }
    }
  }

  private collectReservationConflicts(
    room: RoomWithResources,
    interval: UtcInterval,
    excludeReservationId: string | undefined,
    conflicts: ConflictCheckResult['conflicts'],
    reservationConflicts: ReservationConflictDetail[],
  ): void {
    const resourceIds = new Set(room.resources.map((resource) => resource.id));
    for (const reservation of this.reservationRepository.list()) {
      if (reservation.status !== 'active' || reservation.id === excludeReservationId) {
        continue;
      }
      const reservationInterval = parseUtcInterval(reservation.start, reservation.end);
      if (!intervalsOverlap(reservationInterval, interval)) {
        continue;
      }

      const snapshots = this.reservationRepository.resourceSnapshotsForReservation(reservation.id);
      for (const snapshot of snapshots.filter((candidate) => resourceIds.has(candidate.resourceId))) {
        const snapshotInterval = parseUtcInterval(snapshot.start, snapshot.end);
        if (!intervalsOverlap(snapshotInterval, interval)) {
          continue;
        }
        const reservationRoom = this.roomRepository.findById(snapshot.roomId);
        const resource = room.resources.find((candidate) => candidate.id === snapshot.resourceId);
        const conflict = {
          type: 'reservation' as const,
          id: reservation.id,
          name: reservation.title,
          start: overlapStart(snapshotInterval, interval).startIso,
          end: overlapStart(snapshotInterval, interval).endIso,
          reason: '同一物理资源存在有效预约',
        };
        conflicts.push(conflict);
        reservationConflicts.push({
          reservationId: reservation.id,
          roomId: snapshot.roomId,
          roomName: reservationRoom?.name ?? snapshot.roomId,
          resourceId: snapshot.resourceId,
          resourceName: resource?.name ?? snapshot.resourceId,
          title: reservation.title,
          start: conflict.start,
          end: conflict.end,
          reason: conflict.reason,
        });
      }
    }
  }

  private collectCalendarReservations(room: RoomWithResources, interval: UtcInterval): CalendarReservation[] {
    const resourceIds = new Set(room.resources.map((resource) => resource.id));
    return this.reservationRepository
      .list()
      .flatMap((reservation) => {
        const reservationInterval = parseUtcInterval(reservation.start, reservation.end);
        if (!intervalsOverlap(reservationInterval, interval)) {
          return [];
        }
        const snapshots = this.reservationRepository.resourceSnapshotsForReservation(reservation.id);
        const matchingSnapshots = snapshots.filter((snapshot) => resourceIds.has(snapshot.resourceId));
        if (matchingSnapshots.length === 0) {
          return [];
        }
        return [
          {
            kind: 'reservation',
            id: reservation.id,
            title: reservation.title,
            roomId: room.id,
            roomName: room.name,
            resourceIds: matchingSnapshots.map((snapshot) => snapshot.resourceId),
            resourceNames: matchingSnapshots
              .map((snapshot) => room.resources.find((resource) => resource.id === snapshot.resourceId)?.name ?? snapshot.resourceId)
              .filter(unique),
            start: reservation.start,
            end: reservation.end,
            status: reservation.status,
          } satisfies CalendarReservation,
        ];
      })
      .sort((left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id));
  }

  private collectCalendarBlocks(room: RoomWithResources, interval: UtcInterval): CalendarBlock[] {
    const blocks: CalendarBlock[] = [];
    for (const rule of this.enabledRulesForTargets(room)) {
      for (const blocked of this.ruleBlockingIntervals(rule, interval)) {
        blocks.push({
          kind: 'block',
          id: blocked.ruleId,
          ruleId: blocked.ruleId,
          targetId: blocked.targetId,
          targetName: blocked.targetName,
          start: blocked.start,
          end: blocked.end,
          reason: blocked.reason,
        });
      }
    }

    return blocks.sort((left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id));
  }

  private enabledRulesForTargets(room: RoomWithResources): AvailabilityRule[] {
    const targetIds = new Set([room.id, ...room.resources.map((resource) => resource.id)]);
    return this.ruleRepository
      .list()
      .filter((rule) => rule.enabled && targetIds.has(rule.targetId) && rule.ruleType !== 'open_hours')
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  }

  private ruleBlockingIntervals(rule: AvailabilityRule, queryInterval: UtcInterval): BlockingRuleConflict[] {
    if (rule.ruleType === 'one_time_block') {
      const ruleInterval = parseUtcInterval(rule.start, rule.end);
      const clipped = clipInterval(ruleInterval, queryInterval);
      if (!clipped) {
        return [];
      }
      return [toBlockingRuleConflict(rule, clipped.startIso, clipped.endIso)];
    }

    if (rule.ruleType !== 'periodic_block') {
      return [];
    }

    const recurrence = parseWeeklyRecurrence(rule.recurrence);
    const startDay = toLocalDateKey(queryInterval.start);
    const endDay = toLocalDateKey(new Date(queryInterval.end.getTime() - 1));
    const blocked: BlockingRuleConflict[] = [];
    for (let offset = 0; startDay !== endDay || offset === 0; offset += 1) {
      const day = addLocalDateDays(startDay, offset);
      if (recurrence.weekdays.includes(getShanghaiWeekdayNumber(day))) {
        const occurrence = parseUtcInterval(
          localTimeToUtc(day, recurrence.timeStart).toISOString(),
          localTimeToUtc(day, recurrence.timeEnd).toISOString(),
        );
        const clipped = clipInterval(occurrence, queryInterval);
        if (clipped) {
          blocked.push(toBlockingRuleConflict(rule, clipped.startIso, clipped.endIso));
        }
      }
      if (day === endDay) {
        break;
      }
    }
    return blocked;
  }
}

function outsideOpenHoursSegments(openStart: string, openEnd: string, interval: UtcInterval): UtcInterval[] {
  const startMinutes = parseClockMinutes(openStart);
  const endMinutes = parseClockMinutes(openEnd);
  if (startMinutes >= endMinutes) {
    return [interval];
  }

  const startDay = toLocalDateKey(interval.start);
  const endDay = toLocalDateKey(new Date(interval.end.getTime() - 1));
  const outside: UtcInterval[] = [];
  let cursor = interval.start;

  for (let offset = 0; startDay !== endDay || cursor.getTime() < interval.end.getTime(); offset += 1) {
    const day = addLocalDateDays(startDay, offset);
    const dayStart = localTimeToUtc(day, '00:00');
    const openStartUtc = localTimeToUtc(day, openStart);
    const openEndUtc = localTimeToUtc(day, openEnd);
    const dayEnd = localTimeToUtc(day, '24:00');

    const dayQueryStart = new Date(Math.max(cursor.getTime(), dayStart.getTime()));
    const dayQueryEnd = new Date(Math.min(interval.end.getTime(), dayEnd.getTime()));
    if (dayQueryStart.getTime() < dayQueryEnd.getTime()) {
      addOutsideSegment(outside, dayQueryStart, dayQueryEnd, openStartUtc, openEndUtc);
    }
    cursor = dayEnd;
    if (day === endDay) {
      break;
    }
  }

  return outside;
}

function addOutsideSegment(
  outside: UtcInterval[],
  queryStart: Date,
  queryEnd: Date,
  openStartUtc: Date,
  openEndUtc: Date,
): void {
  if (queryStart.getTime() < openStartUtc.getTime()) {
    outside.push(parseUtcInterval(
      new Date(Math.max(queryStart.getTime(), localTimeToUtc(toLocalDateKey(queryStart), '00:00').getTime())).toISOString(),
      new Date(Math.min(queryEnd.getTime(), openStartUtc.getTime())).toISOString(),
    ));
  }
  if (queryEnd.getTime() > openEndUtc.getTime()) {
    outside.push(parseUtcInterval(
      new Date(Math.max(queryStart.getTime(), openEndUtc.getTime())).toISOString(),
      new Date(Math.min(queryEnd.getTime(), localTimeToUtc(toLocalDateKey(queryEnd), '24:00').getTime())).toISOString(),
    ));
  }
}

function parseWeeklyRecurrence(recurrence?: string): WeeklyRecurrence {
  if (!recurrence) {
    throw new AppError('VALIDATION_ERROR', '周期规则必须包含 recurrence');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(recurrence);
  } catch {
    throw new AppError('VALIDATION_ERROR', '周期规则 recurrence 必须是合法 JSON');
  }

  if (!isObject(parsed) || parsed.type !== 'weekly' || !Array.isArray(parsed.weekdays)) {
    throw new AppError('VALIDATION_ERROR', '周期规则 recurrence 必须包含 weekly.weekdays');
  }
  if (!parsed.weekdays.every((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)) {
    throw new AppError('VALIDATION_ERROR', '周期规则 weekday 必须是 0-6 的整数');
  }
  if (typeof parsed.timeStart !== 'string' || typeof parsed.timeEnd !== 'string') {
    throw new AppError('VALIDATION_ERROR', '周期规则 recurrence 必须包含 timeStart 和 timeEnd');
  }
  parseClockMinutes(parsed.timeStart);
  parseClockMinutes(parsed.timeEnd, true);
  return parsed as unknown as WeeklyRecurrence;
}

function toBlockingRuleConflict(rule: AvailabilityRule, start: string, end: string): BlockingRuleConflict {
  return {
    ruleId: rule.id,
    targetId: rule.targetId,
    targetName: rule.targetId,
    start,
    end,
    reason: rule.reason,
  };
}

function overlapStart(left: UtcInterval, right: UtcInterval): UtcInterval {
  return parseUtcInterval(
    new Date(Math.max(left.start.getTime(), right.start.getTime())).toISOString(),
    new Date(Math.min(left.end.getTime(), right.end.getTime())).toISOString(),
  );
}

function getShanghaiWeekdayNumber(dateKey: string): number {
  return getShanghaiWeekday(localTimeToUtc(dateKey, '00:00'));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unique<T>(value: T, index: number, array: T[]): boolean {
  return array.indexOf(value) === index;
}
