import type { ConflictDetail } from '@/errors/AppError';
import type { Resource } from '@/domain/resource/types';
import type { Room } from '@/domain/room/types';

export interface AvailabilityQueryInput {
  start: string;
  end: string;
  capacity?: number;
  equipment?: string[];
}

export interface ConflictCheckInput {
  roomId: string;
  start: string;
  end: string;
  excludeReservationId?: string;
}

export interface AvailableRoom extends Room {
  resources: Resource[];
}

export interface BlockingRuleConflict {
  ruleId: string;
  targetId: string;
  targetName: string;
  start: string;
  end: string;
  reason: string;
}

export interface ReservationConflictDetail {
  reservationId: string;
  roomId: string;
  roomName: string;
  resourceId: string;
  resourceName: string;
  title: string;
  start: string;
  end: string;
  reason: string;
}

export interface ConflictCheckResult {
  roomId: string;
  roomName: string;
  resources: Resource[];
  start: string;
  end: string;
  conflicts: ConflictDetail[];
  blockingRules: BlockingRuleConflict[];
  reservationConflicts: ReservationConflictDetail[];
  isAvailable: boolean;
}

export interface CalendarReservation {
  kind: 'reservation';
  id: string;
  title: string;
  roomId: string;
  roomName: string;
  resourceIds: string[];
  resourceNames: string[];
  start: string;
  end: string;
  status: string;
}

export interface CalendarBlock {
  kind: 'block';
  id: string;
  ruleId: string;
  targetId: string;
  targetName: string;
  start: string;
  end: string;
  reason: string;
}

export interface RoomCalendar {
  roomId: string;
  roomName: string;
  from: string;
  to: string;
  reservations: CalendarReservation[];
  blocks: CalendarBlock[];
}
