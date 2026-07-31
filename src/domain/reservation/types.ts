export type ReservationStatus = "active" | "cancelled";

export interface Reservation {
  id: string;
  title: string;
  description: string;
  roomId: string;
  start: string;
  end: string;
  status: ReservationStatus;
  idempotencyKey?: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string | null;
  cancelledReason?: string | null;
}

export interface CreateReservationInput {
  id?: string;
  title: string;
  description?: string;
  roomId: string;
  start: string;
  end: string;
  status?: ReservationStatus;
  idempotencyKey?: string | null;
  version?: number;
  createdAt?: string;
  updatedAt?: string;
  cancelledAt?: string | null;
  cancelledReason?: string | null;
}

export interface UpdateReservationInput {
  title?: string;
  description?: string;
  roomId?: string;
  start?: string;
  end?: string;
  version?: number;
}

export interface CancelReservationInput {
  version?: number;
  reason?: string;
  idempotencyKey?: string | null;
}

export interface ForceAdjustReservationInput {
  roomId: string;
  start: string;
  end: string;
  reason: string;
  force: boolean;
  version?: number;
  idempotencyKey?: string | null;
}

export interface ReservationResourceSnapshot {
  reservationId: string;
  resourceId: string;
  roomId: string;
  start: string;
  end: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReservationWithResources extends Reservation {
  resources: ReservationResourceSnapshot[];
  auditEventIds?: string[];
}

export interface ForceAdjustReservationResult {
  reservation: ReservationWithResources;
  cancelledReservations: ReservationWithResources[];
  conflicts: Array<{
    reservationId: string;
    roomId: string;
    roomName: string;
    resourceId: string;
    resourceName: string;
    title: string;
    start: string;
    end: string;
    reason: string;
  }>;
  auditEventIds: string[];
}
