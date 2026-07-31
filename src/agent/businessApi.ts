/**
 * Backend business API client for the meeting-room Agent orchestrator.
 *
 * RFC-0002: The orchestrator never writes database state directly. It delegates
 * availability checks, booking mutations, unavailability rules, and room
 * configuration to the backend contract so permission, conflict, and state
 * decisions remain authoritative.
 */

import type {
  AgentAction,
  AgentError,
  AgentIntent,
  AvailabilityFilters,
  CreateCombinedRoomIntent,
  CreateOrUpdateRoomIntent,
} from './types.js';

export interface BackendBusinessApiClient {
  checkAvailability(request: AvailabilityCheckRequest): Promise<AvailabilityCheckResult>;
  createBooking(request: CreateBookingRequest): Promise<BookingResult>;
  cancelBooking(request: CancelBookingRequest): Promise<BookingResult>;
  conflictCheck(request: ConflictCheckRequest): Promise<ConflictCheckResult>;
  listRooms(): Promise<Room[]>;
  createUnavailabilityRule(request: CreateUnavailabilityRuleRequest): Promise<UnavailabilityRuleResult>;
  updateUnavailabilityRule(request: UpdateUnavailabilityRuleRequest): Promise<UnavailabilityRuleResult>;
  createOrUpdateRoom(request: CreateOrUpdateRoomRequest): Promise<RoomResult>;
  createCombinedRoom(request: CreateCombinedRoomRequest): Promise<RoomResult>;
}

export interface AvailabilityCheckRequest {
  date: string;
  startTime: string;
  endTime: string;
  filters?: Record<string, unknown> | AvailabilityFilters;
}

export interface AvailabilityCheckResult {
  availableRooms?: Room[];
  conflicts?: ConflictDetail[];
}

export interface CreateBookingRequest {
  userId: string;
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  title?: string;
  description?: string;
  attendees?: number;
}

export interface BookingResult {
  booking?: Booking;
  conflict?: ConflictDetail;
}

export interface CancelBookingRequest {
  bookingId?: string;
  roomId?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  title?: string;
  userId?: string;
}

export interface ConflictCheckRequest {
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
}

export interface ConflictCheckResult {
  available: boolean;
  conflicts?: ConflictDetail[];
}

export interface CreateUnavailabilityRuleRequest {
  target: string;
  date?: string;
  timeRange?: { startTime: string; endTime: string };
  recurring?: { daysOfWeek: number[]; timeRange: { startTime: string; endTime: string } };
  reason: string;
}

export interface UpdateUnavailabilityRuleRequest {
  target?: string;
  date?: string;
  timeRange?: { startTime: string; endTime: string };
  recurring?: { daysOfWeek: number[]; timeRange: { startTime: string; endTime: string } };
  reason?: string;
}

export interface UnavailabilityRuleResult {
  rule?: UnavailabilityRule;
  updatedRuleId?: string;
}

export interface CreateOrUpdateRoomRequest {
  roomId: string;
  name?: string;
  location?: string;
  capacity?: number;
  roomType?: string;
  equipment?: string[];
}

export interface CreateCombinedRoomRequest {
  combinedRoomId: string;
  name?: string;
  componentRoomIds: string[];
  capacity?: number;
  equipment?: string[];
}

export interface RoomResult {
  room?: Room;
}

export interface Room {
  id: string;
  name: string;
  type: string;
  capacity: number;
  location: string;
  equipment?: string[];
  enabled?: boolean;
  openStart?: string;
  openEnd?: string;
  version?: number;
}

export interface Booking {
  id: string;
  title: string;
  description?: string;
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'active' | 'cancelled';
  version?: number;
}

export interface UnavailabilityRule {
  id: string;
  target: string;
  date?: string;
  timeRange?: { startTime: string; endTime: string };
  recurring?: { daysOfWeek: number[]; timeRange: { startTime: string; endTime: string } };
  reason: string;
  enabled?: boolean;
  version?: number;
}

export interface ConflictDetail {
  type: string;
  id: string;
  name: string;
  start?: string;
  end?: string;
  reason?: string;
}

export interface BackendBusinessApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    conflicts?: ConflictDetail[];
  };
}

export interface CreateBusinessApiClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createBusinessApiClient(options: CreateBusinessApiClientOptions = {}): BackendBusinessApiClient {
  const normalizedBaseUrl = trimTrailingSlash(options.baseUrl ?? process.env.MEETING_ROOM_API_BASE_URL ?? '');
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async checkAvailability(request) {
      return sendJson<AvailabilityCheckResult>(
        fetchImpl,
        normalizedBaseUrl,
        '/api/availability/check',
        'POST',
        request,
      );
    },
    async createBooking(request) {
      return sendJson<BookingResult>(
        fetchImpl,
        normalizedBaseUrl,
        '/api/bookings',
        'POST',
        request,
      );
    },
    async cancelBooking(request) {
      const { bookingId, ...query } = request;
      const path = bookingId ? `/api/bookings/${encodeURIComponent(bookingId)}` : '/api/bookings';
      return sendJson<BookingResult>(
        fetchImpl,
        normalizedBaseUrl,
        path,
        bookingId ? 'DELETE' : 'POST',
        bookingId ? undefined : query,
        bookingId ? query : undefined,
      );
    },
    async conflictCheck(request) {
      return sendJson<ConflictCheckResult>(
        fetchImpl,
        normalizedBaseUrl,
        '/api/bookings/conflict-check',
        'POST',
        request,
      );
    },
    async listRooms() {
      return sendJson<Room[]>(fetchImpl, normalizedBaseUrl, '/api/rooms', 'GET');
    },
    async createUnavailabilityRule(request) {
      return sendJson<UnavailabilityRuleResult>(
        fetchImpl,
        normalizedBaseUrl,
        '/api/unavailability-rules',
        'POST',
        request,
      );
    },
    async updateUnavailabilityRule(request) {
      return sendJson<UnavailabilityRuleResult>(
        fetchImpl,
        normalizedBaseUrl,
        '/api/unavailability-rules/last',
        'PATCH',
        request,
      );
    },
    async createOrUpdateRoom(request) {
      return sendJson<RoomResult>(
        fetchImpl,
        normalizedBaseUrl,
        `/api/rooms/${encodeURIComponent(request.roomId)}`,
        'POST',
        request,
      );
    },
    async createCombinedRoom(request) {
      return sendJson<RoomResult>(
        fetchImpl,
        normalizedBaseUrl,
        '/api/room-groups',
        'POST',
        request,
      );
    },
  };
}

export interface OrchestratorContext {
  userId: string;
  authContext?: unknown;
  client: BackendBusinessApiClient;
}

export interface OrchestratorResult {
  actions: AgentAction[];
  error?: AgentError;
  data?: unknown;
}

export async function orchestrateAgentIntent(intent: AgentIntent, context: OrchestratorContext): Promise<OrchestratorResult> {
  const actions: AgentAction[] = [];

  try {
    switch (intent.type) {
      case 'need_clarification':
        return { actions };
      case 'query_available_rooms': {
        const action = createAction('query_available_rooms', 'planned', '/api/availability/check', {
          date: intent.date,
          startTime: intent.timeRange.startTime,
          endTime: intent.timeRange.endTime,
          filters: intent.filters,
        });
        actions.push(action);
        const result = await context.client.checkAvailability({
          date: intent.date,
          startTime: intent.timeRange.startTime,
          endTime: intent.timeRange.endTime,
          filters: intent.filters,
        });
        action.status = 'completed';
        action.result = result;
        return { actions, data: result };
      }
      case 'create_booking': {
        const action = createAction('create_booking', 'planned', '/api/bookings', {
          userId: intent.userId ?? context.userId,
          roomId: intent.roomId,
          date: intent.date,
          startTime: intent.timeRange.startTime,
          endTime: intent.timeRange.endTime,
          title: intent.title,
          description: intent.description,
          attendees: intent.attendees,
          authContext: context.authContext,
        });
        actions.push(action);
        const result = await context.client.createBooking({
          userId: intent.userId ?? context.userId,
          roomId: intent.roomId,
          date: intent.date,
          startTime: intent.timeRange.startTime,
          endTime: intent.timeRange.endTime,
          title: intent.title,
          description: intent.description,
          attendees: intent.attendees,
        });
        action.status = 'completed';
        action.result = result;
        return { actions, data: result };
      }
      case 'cancel_booking': {
        const action = createAction('cancel_booking', 'planned', '/api/bookings', {
          bookingId: intent.bookingId,
          roomId: intent.roomId,
          date: intent.date,
          startTime: intent.timeRange?.startTime,
          endTime: intent.timeRange?.endTime,
          title: intent.title,
          authContext: context.authContext,
        });
        actions.push(action);
        const result = await context.client.cancelBooking({
          bookingId: intent.bookingId,
          roomId: intent.roomId,
          date: intent.date,
          startTime: intent.timeRange?.startTime,
          endTime: intent.timeRange?.endTime,
          title: intent.title,
          userId: context.userId,
        });
        action.status = 'completed';
        action.result = result;
        return { actions, data: result };
      }
      case 'create_unavailability_rule': {
        const action = createAction('create_unavailability_rule', 'planned', '/api/unavailability-rules', {
          target: intent.target,
          date: intent.date,
          timeRange: intent.timeRange,
          recurring: intent.recurring,
          reason: intent.reason,
          authContext: context.authContext,
        });
        actions.push(action);
        const result = await context.client.createUnavailabilityRule({
          target: intent.target,
          date: intent.date,
          timeRange: intent.timeRange,
          recurring: intent.recurring,
          reason: intent.reason,
        });
        action.status = 'completed';
        action.result = result;
        return { actions, data: result };
      }
      case 'update_last_unavailability_rule': {
        const action = createAction('update_last_unavailability_rule', 'planned', '/api/unavailability-rules/last', {
          target: intent.target,
          date: intent.date,
          timeRange: intent.timeRange,
          recurring: intent.recurring,
          reason: intent.reason,
          authContext: context.authContext,
        });
        actions.push(action);
        const result = await context.client.updateUnavailabilityRule({
          target: intent.target,
          date: intent.date,
          timeRange: intent.timeRange,
          recurring: intent.recurring,
          reason: intent.reason,
        });
        action.status = 'completed';
        action.result = result;
        return { actions, data: result };
      }
      case 'create_or_update_room': {
        const action = createAction('create_or_update_room', 'planned', `/api/rooms/${encodeURIComponent(intent.roomId)}`, {
          roomId: intent.roomId,
          name: intent.name,
          location: intent.location,
          capacity: intent.capacity,
          roomType: intent.roomType,
          equipment: intent.equipment,
          authContext: context.authContext,
        });
        actions.push(action);
        const result = await context.client.createOrUpdateRoom(toRoomConfigPayload(intent));
        action.status = 'completed';
        action.result = result;
        return { actions, data: result };
      }
      case 'create_combined_room': {
        const action = createAction('create_combined_room', 'planned', '/api/room-groups', {
          combinedRoomId: intent.combinedRoomId,
          name: intent.name,
          componentRoomIds: intent.componentRoomIds,
          capacity: intent.capacity,
          equipment: intent.equipment,
          authContext: context.authContext,
        });
        actions.push(action);
        const result = await context.client.createCombinedRoom(toCombinedRoomPayload(intent));
        action.status = 'completed';
        action.result = result;
        return { actions, data: result };
      }
      default:
        return assertNever(intent);
    }
  } catch (error) {
    const agentError = mapBackendError(error);
    const failedAction = actions[actions.length - 1];
    if (failedAction) {
      failedAction.status = 'failed';
      failedAction.error = agentError;
    }
    return { actions, error: agentError };
  }
}

function createAction(type: string, status: AgentAction['status'], endpoint: string, payload: unknown): AgentAction {
  return {
    type,
    status,
    endpoint,
    payload,
  };
}

function toRoomConfigPayload(intent: CreateOrUpdateRoomIntent): CreateOrUpdateRoomRequest {
  return {
    roomId: intent.roomId,
    name: intent.name,
    location: intent.location,
    capacity: intent.capacity,
    roomType: intent.roomType,
    equipment: intent.equipment,
  };
}

function toCombinedRoomPayload(intent: CreateCombinedRoomIntent): CreateCombinedRoomRequest {
  return {
    combinedRoomId: intent.combinedRoomId,
    name: intent.name,
    componentRoomIds: intent.componentRoomIds,
    capacity: intent.capacity,
    equipment: intent.equipment,
  };
}

async function sendJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
  query?: unknown,
): Promise<T> {
  const url = query && method !== 'DELETE'
    ? appendQuery(`${baseUrl}${path}`, query)
    : `${baseUrl}${path}`;

  const response = await fetchImpl(url, {
    method,
    headers: body === undefined ? undefined : {
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseJsonBody<BackendBusinessApiErrorBody | T>(response);
  if (!response.ok) {
    throw toAgentHttpError(response, payload);
  }

  return payload as T;
}

function appendQuery(baseUrl: string, query: unknown): string {
  const params = new URLSearchParams();
  if (isRecord(query)) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
  }
  const queryString = params.toString();
  return queryString ? `${baseUrl}?${queryString}` : baseUrl;
}

async function parseJsonBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.trim() === '') {
    return {} as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {
      error: {
        code: `HTTP_${response.status}`,
        message: text,
      },
    } as T;
  }
}

function toAgentHttpError(response: Response, payload: unknown): AgentError {
  const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  const code = typeof errorPayload?.code === 'string' ? errorPayload.code : undefined;
  const message = typeof errorPayload?.message === 'string'
    ? errorPayload.message
    : `Backend API request failed with ${response.status}.`;
  const conflicts = Array.isArray(errorPayload?.conflicts) ? errorPayload.conflicts : undefined;

  return {
    type: mapAgentErrorType(response.status, code),
    message,
    details: {
      httpStatus: response.status,
      code,
      conflicts,
    },
  };
}

function mapAgentErrorType(status: number, code?: string): AgentError['type'] {
  if (status === 401 || status === 403 || code === 'PERMISSION_DENIED' || code === 'FORBIDDEN') {
    return 'permission_denied';
  }

  if (
    status === 409
    || code === 'RESERVATION_CONFLICT'
    || code === 'RULE_BLOCKED'
    || code === 'OUTSIDE_OPEN_HOURS'
    || code === 'VERSION_CONFLICT'
    || code === 'IDEMPOTENCY_CONFLICT'
  ) {
    return 'conflict';
  }

  if (status === 404 || code === 'NOT_FOUND') {
    return 'not_found';
  }

  if (status >= 500 || status === 0) {
    return 'backend_unavailable';
  }

  return 'backend_unavailable';
}

function mapBackendError(error: unknown): AgentError {
  if (isAgentError(error)) {
    return error;
  }

  return {
    type: 'backend_unavailable',
    message: error instanceof Error ? error.message : 'Backend API request failed.',
    details: error instanceof Error ? { name: error.name } : undefined,
  };
}

function isAgentError(error: unknown): error is AgentError {
  if (!isRecord(error)) {
    return false;
  }

  const type = error.type;
  const message = error.message;
  return (
    (type === 'need_clarification'
      || type === 'permission_denied'
      || type === 'conflict'
      || type === 'not_found'
      || type === 'backend_unavailable'
      || type === 'parse_failed')
    && typeof message === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled AgentIntent type: ${String(value)}`);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}
