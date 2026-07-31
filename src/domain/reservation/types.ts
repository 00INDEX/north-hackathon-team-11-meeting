export type ReservationStatus = 'active' | 'cancelled';

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
  id: string;
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
