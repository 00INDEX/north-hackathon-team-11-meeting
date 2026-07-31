/**
 * Backend business API client for the meeting-room Agent orchestrator.
 *
 * RFC-0002: The orchestrator never writes database state directly. It delegates
 * availability checks, booking mutations, unavailability rules, and room
 * configuration to the backend contract so permission, conflict, and state
 * decisions remain authoritative.
 *
 * RFC-0003 T1: This adapter maps Agent intents to RFC-0001 authoritative APIs
 * and must not depend on private endpoints such as /api/bookings or
 * /api/unavailability-rules/last.
 */

import { createHash } from "node:crypto";
import type {
  AgentAction,
  AgentError,
  AgentIntent,
  AvailabilityFilters,
  CreateCombinedRoomIntent,
  CreateOrUpdateRoomIntent,
} from "./types.js";
import { combineLocalDateTime } from "@/time";

const FAR_FUTURE_UTC = "9999-12-31T15:59:59.999Z";
const RECURRENCE_START_UTC = "1970-01-01T00:00:00.000Z";

export interface BackendBusinessApiClient {
  checkAvailability(
    request: AvailabilityCheckRequest,
  ): Promise<AvailabilityCheckResult>;
  createBooking(request: CreateBookingRequest): Promise<BookingResult>;
  cancelBooking(request: CancelBookingRequest): Promise<BookingResult>;
  conflictCheck(request: ConflictCheckRequest): Promise<ConflictCheckResult>;
  listRooms(): Promise<Room[]>;
  createUnavailabilityRule(
    request: CreateUnavailabilityRuleRequest,
  ): Promise<UnavailabilityRuleResult>;
  updateUnavailabilityRule(
    request: UpdateUnavailabilityRuleRequest,
  ): Promise<UnavailabilityRuleResult>;
  createOrUpdateRoom(request: CreateOrUpdateRoomRequest): Promise<RoomResult>;
  createCombinedRoom(request: CreateCombinedRoomRequest): Promise<RoomResult>;
  resolveRoomReferences?(references: string[]): Promise<Room[]>;
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
  idempotencyKey?: string;
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
  idempotencyKey?: string;
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
  recurring?: {
    daysOfWeek: number[];
    timeRange: { startTime: string; endTime: string };
  };
  reason: string;
  userId?: string;
  idempotencyKey?: string;
}

export interface UpdateUnavailabilityRuleRequest {
  ruleId?: string;
  target?: string;
  date?: string;
  timeRange?: { startTime: string; endTime: string };
  recurring?: {
    daysOfWeek: number[];
    timeRange: { startTime: string; endTime: string };
  };
  reason?: string;
  userId?: string;
  idempotencyKey?: string;
}

export interface BackendRoom {
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
  componentRoomIds?: string[];
}

export interface BackendReservation {
  id: string;
  title: string;
  description?: string;
  roomId: string;
  start: string;
  end: string;
  status: "active" | "cancelled";
  version?: number;
}

export interface BackendRule {
  id: string;
  targetType: string;
  targetId: string;
  ruleType: string;
  reason: string;
  enabled?: boolean;
  isSystem?: boolean;
  recurrence?: string;
  start: string;
  end: string;
  version?: number;
  createdAt?: string;
  updatedAt: string;
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
  userId?: string;
  idempotencyKey?: string;
}

export interface CreateCombinedRoomRequest {
  combinedRoomId: string;
  name?: string;
  componentRoomIds: string[];
  capacity?: number;
  equipment?: string[];
  userId?: string;
  idempotencyKey?: string;
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
  componentRoomIds?: string[];
}

export interface Booking {
  id: string;
  title: string;
  description?: string;
  roomId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: "active" | "cancelled";
  version?: number;
}

export interface UnavailabilityRule {
  id: string;
  target: string;
  date?: string;
  timeRange?: { startTime: string; endTime: string };
  recurring?: {
    daysOfWeek: number[];
    timeRange: { startTime: string; endTime: string };
  };
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
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
}

const DEFAULT_BUSINESS_API_TIMEOUT_MS = 8_000;
const DEFAULT_BUSINESS_API_MAX_RETRIES = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 100;

export function createBusinessApiClient(
  options: CreateBusinessApiClientOptions = {},
): BackendBusinessApiClient {
  const normalizedBaseUrl = trimTrailingSlash(
    options.baseUrl ?? process.env.MEETING_ROOM_API_BASE_URL ?? "",
  );
  const fetchImpl = createResilientFetch(options.fetchImpl ?? fetch, {
    timeoutMs: options.timeoutMs ?? DEFAULT_BUSINESS_API_TIMEOUT_MS,
    maxRetries: options.maxRetries ?? DEFAULT_BUSINESS_API_MAX_RETRIES,
    retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
  });

  return {
    async checkAvailability(request) {
      const filters = request.filters ?? {};
      const rooms = expectRoomArray(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          "/api/availability",
          "GET",
          undefined,
          {
            start: agentDateTimeToUtc(request.date, request.startTime),
            end: agentDateTimeToUtc(request.date, request.endTime),
            equipment: Array.isArray(filters.equipment)
              ? filters.equipment.join(",")
              : undefined,
          },
        ),
      );
      const requestedType =
        typeof filters.roomType === "string" ? filters.roomType : undefined;
      const minCapacity =
        typeof filters.minCapacity === "number"
          ? filters.minCapacity
          : undefined;
      return {
        availableRooms: rooms
          .filter(
            (room) => minCapacity === undefined || room.capacity >= minCapacity,
          )
          .filter(
            (room) =>
              !requestedType || matchesAgentRoomType(room.type, requestedType),
          )
          .filter(
            (room) =>
              filters.combinedRoom !== true || room.type === "组合会议室",
          )
          .map(toAgentRoom),
      };
    },
    async createBooking(request) {
      const roomId = await resolveSingleRoomId(
        fetchImpl,
        normalizedBaseUrl,
        request.roomId,
      );
      const idempotencyKey =
        request.idempotencyKey ??
        createStableIdempotencyKey("create_booking", request);
      const reservation = expectReservation(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          "/api/reservations",
          "POST",
          {
            id: reservationIdForIdempotencyKey(idempotencyKey),
            title: request.title ?? "会议预约",
            description: request.description,
            roomId,
            start: agentDateTimeToUtc(request.date, request.startTime),
            end: agentDateTimeToUtc(request.date, request.endTime),
          },
          undefined,
          mutationHeaders(request.userId, idempotencyKey),
        ),
      );
      return { booking: toAgentBooking(reservation) };
    },
    async cancelBooking(request) {
      let reservationId = request.bookingId;
      if (!reservationId) {
        const candidates = await findMatchingReservations(
          fetchImpl,
          normalizedBaseUrl,
          request,
        );
        if (candidates.length === 0) {
          throw {
            type: "not_found",
            message: "没有找到符合条件的有效预约。",
          } satisfies AgentError;
        }
        if (candidates.length > 1) {
          throw {
            type: "need_clarification",
            message: "找到多个符合条件的预约，请提供预约 ID。",
            details: {
              conflicts: candidates.map((candidate) => ({
                type: "reservation",
                id: candidate.id,
                name: candidate.title,
                start: candidate.start,
                end: candidate.end,
              })),
            },
          } satisfies AgentError;
        }
        reservationId = candidates[0].id;
      }
      const idempotencyKey =
        request.idempotencyKey ??
        createStableIdempotencyKey("cancel_booking", {
          ...request,
          bookingId: reservationId,
        });
      const reservation = expectReservation(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          `/api/reservations/${encodeURIComponent(reservationId)}/cancel`,
          "POST",
          { reason: "由会议室 Agent 取消" },
          undefined,
          mutationHeaders(request.userId, idempotencyKey),
        ),
      );
      return { booking: toAgentBooking(reservation) };
    },
    async conflictCheck(request) {
      const roomId = await resolveSingleRoomId(
        fetchImpl,
        normalizedBaseUrl,
        request.roomId,
      );
      const rooms = expectRoomArray(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          "/api/availability",
          "GET",
          undefined,
          {
            start: agentDateTimeToUtc(request.date, request.startTime),
            end: agentDateTimeToUtc(request.date, request.endTime),
          },
        ),
      );
      return {
        available: rooms.some((room) => room.id === roomId),
      };
    },
    async listRooms() {
      const rooms = expectRoomArray(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          "/api/rooms",
          "GET",
        ),
      );
      return rooms.map(toAgentRoom);
    },
    async createUnavailabilityRule(request) {
      const target = await resolveSingleRoomId(
        fetchImpl,
        normalizedBaseUrl,
        request.target,
      );
      const idempotencyKey =
        request.idempotencyKey ??
        createStableIdempotencyKey("create_unavailability_rule", {
          ...request,
          target,
        });
      const rule = expectRule(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          "/api/rules",
          "POST",
          toCreateRulePayload({ ...request, target }),
          undefined,
          mutationHeaders(request.userId, idempotencyKey),
        ),
      );
      return { rule: toAgentRule(rule) };
    },
    async updateUnavailabilityRule(request) {
      if (!request.ruleId) {
        throw {
          type: "need_clarification",
          message: "没有找到上一条规则的稳定 ruleId，请先明确要修改的规则。",
        } satisfies AgentError;
      }
      const rule = expectRule(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          `/api/rules/${encodeURIComponent(request.ruleId)}`,
          "GET",
        ),
      );
      const target = request.target
        ? await resolveSingleRoomId(
            fetchImpl,
            normalizedBaseUrl,
            request.target,
          )
        : undefined;
      const idempotencyKey =
        request.idempotencyKey ??
        createStableIdempotencyKey("update_unavailability_rule", {
          ...request,
          target,
        });
      const updated = expectRule(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          `/api/rules/${encodeURIComponent(rule.id)}`,
          "PATCH",
          toUpdateRulePayload(rule, { ...request, target }),
          undefined,
          mutationHeaders(request.userId, idempotencyKey),
        ),
      );
      return {
        updatedRuleId: updated.id,
        rule: toAgentRule(updated),
      };
    },
    async createOrUpdateRoom(request) {
      const rooms = expectRoomArray(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          "/api/rooms",
          "GET",
        ),
      );
      const existing = resolveRoomReference(request.roomId, rooms, {
        allowNotFound: true,
      });
      const roomId = existing?.id ?? normalizeRoomId(request.roomId);
      const idempotencyKey =
        request.idempotencyKey ??
        createStableIdempotencyKey("create_or_update_room", {
          ...request,
          roomId,
        });
      const room = existing
        ? expectRoom(
            await sendJson<unknown>(
              fetchImpl,
              normalizedBaseUrl,
              `/api/rooms/${encodeURIComponent(roomId)}`,
              "PATCH",
              {
                name: request.name,
                location: request.location,
                capacity: request.capacity,
                type: request.roomType
                  ? toBackendRoomType(request.roomType)
                  : undefined,
                equipment: request.equipment,
                version: existing.version,
              },
              undefined,
              mutationHeaders(request.userId, idempotencyKey),
            ),
          )
        : expectRoom(
            await sendJson<unknown>(
              fetchImpl,
              normalizedBaseUrl,
              "/api/rooms",
              "POST",
              {
                id: roomId,
                name: request.name ?? roomId.replace(/^room-/, ""),
                location: request.location ?? "待配置",
                capacity: request.capacity,
                type: toBackendRoomType(request.roomType),
                equipment: request.equipment ?? [],
              },
              undefined,
              mutationHeaders(request.userId, idempotencyKey),
            ),
          );
      return { room: toAgentRoom(room) };
    },
    async createCombinedRoom(request) {
      const componentRooms = await resolveRoomIds(
        fetchImpl,
        normalizedBaseUrl,
        request.componentRoomIds,
      );
      const componentRoomIds = componentRooms.map((room) => room.id);
      const combinedRoomId = normalizeRoomId(request.combinedRoomId);
      if (componentRoomIds.includes(combinedRoomId)) {
        throw {
          type: "need_clarification",
          message: "组合会议室不能包含自身。",
        } satisfies AgentError;
      }
      const idempotencyKey =
        request.idempotencyKey ??
        createStableIdempotencyKey("create_combined_room", {
          ...request,
          combinedRoomId,
          componentRoomIds,
        });
      const room = expectRoom(
        await sendJson<unknown>(
          fetchImpl,
          normalizedBaseUrl,
          "/api/rooms/combined",
          "POST",
          {
            id: combinedRoomId,
            name: request.name,
            componentRoomIds,
            capacity: request.capacity,
            equipment: request.equipment,
          },
          undefined,
          mutationHeaders(request.userId, idempotencyKey),
        ),
      );
      return { room: toAgentRoom({ ...room, componentRoomIds }) };
    },
    async resolveRoomReferences(references) {
      return (
        await resolveRoomIds(fetchImpl, normalizedBaseUrl, references)
      ).map(toAgentRoom);
    },
  };
}

export interface OrchestratorContext {
  userId: string;
  authContext?: unknown;
  conversationId?: string;
  requestId?: string;
  client: BackendBusinessApiClient;
}

export interface OrchestratorResult {
  actions: AgentAction[];
  error?: AgentError;
  data?: unknown;
}

export async function orchestrateAgentIntent(
  intent: AgentIntent,
  context: OrchestratorContext,
): Promise<OrchestratorResult> {
  const actions: AgentAction[] = [];

  try {
    switch (intent.type) {
      case "need_clarification":
        return { actions };
      case "query_available_rooms": {
        const action = createAction(
          "query_available_rooms",
          "planned",
          "/api/availability",
          {
            method: "GET",
            query: {
              start: agentDateTimeToUtc(
                intent.date,
                intent.timeRange.startTime,
              ),
              end: agentDateTimeToUtc(intent.date, intent.timeRange.endTime),
              equipment: Array.isArray(intent.filters?.equipment)
                ? intent.filters.equipment.join(",")
                : undefined,
            },
          },
        );
        actions.push(action);
        const result = await context.client.checkAvailability({
          date: intent.date,
          startTime: intent.timeRange.startTime,
          endTime: intent.timeRange.endTime,
          filters: intent.filters,
        });
        action.status = "completed";
        action.result = result;
        return { actions, data: result };
      }
      case "create_booking": {
        const [roomId] = await resolveIntentRoomIds(context.client, [
          intent.roomId,
        ]);
        const idempotencyKey = mutationIdempotencyKey(
          context,
          "create_booking",
          {
            ...intent,
            roomId,
          },
        );
        const action = createAction(
          "create_booking",
          "planned",
          "/api/reservations",
          {
            method: "POST",
            body: {
              id: reservationIdForIdempotencyKey(idempotencyKey),
              title: intent.title ?? "会议预约",
              description: intent.description,
              roomId,
              start: agentDateTimeToUtc(
                intent.date,
                intent.timeRange.startTime,
              ),
              end: agentDateTimeToUtc(intent.date, intent.timeRange.endTime),
            },
            headers: {
              "x-actor": context.userId,
              "x-idempotency-key": idempotencyKey,
            },
          },
        );
        actions.push(action);
        const result = await context.client.createBooking({
          userId: context.userId,
          roomId,
          date: intent.date,
          startTime: intent.timeRange.startTime,
          endTime: intent.timeRange.endTime,
          title: intent.title,
          description: intent.description,
          attendees: intent.attendees,
          idempotencyKey,
        });
        action.status = "completed";
        action.result = result;
        return { actions, data: result };
      }
      case "cancel_booking": {
        const roomId = intent.roomId
          ? (await resolveIntentRoomIds(context.client, [intent.roomId]))[0]
          : undefined;
        const idempotencyKey = mutationIdempotencyKey(
          context,
          "cancel_booking",
          {
            ...intent,
            roomId,
          },
        );
        const endpoint = intent.bookingId
          ? `/api/reservations/${encodeURIComponent(intent.bookingId)}/cancel`
          : "/api/reservations";
        const action = createAction("cancel_booking", "planned", endpoint, {
          method: intent.bookingId ? "POST" : "GET",
          query: intent.bookingId
            ? undefined
            : {
                from:
                  intent.date && intent.timeRange
                    ? agentDateTimeToUtc(
                        intent.date,
                        intent.timeRange.startTime,
                      )
                    : undefined,
                to:
                  intent.date && intent.timeRange
                    ? agentDateTimeToUtc(intent.date, intent.timeRange.endTime)
                    : undefined,
                roomId,
                status: "active",
              },
          body: intent.bookingId
            ? { reason: "由会议室 Agent 取消" }
            : undefined,
          headers: intent.bookingId
            ? {
                "x-actor": context.userId,
                "x-idempotency-key": idempotencyKey,
              }
            : undefined,
        });
        actions.push(action);
        const result = await context.client.cancelBooking({
          bookingId: intent.bookingId,
          roomId,
          date: intent.date,
          startTime: intent.timeRange?.startTime,
          endTime: intent.timeRange?.endTime,
          title: intent.title,
          userId: context.userId,
          idempotencyKey,
        });
        action.status = "completed";
        action.result = result;
        return { actions, data: result };
      }
      case "create_unavailability_rule": {
        const [target] = await resolveIntentRoomIds(context.client, [
          intent.target,
        ]);
        const idempotencyKey = mutationIdempotencyKey(
          context,
          "create_unavailability_rule",
          {
            ...intent,
            target,
          },
        );
        const action = createAction(
          "create_unavailability_rule",
          "planned",
          "/api/rules",
          {
            method: "POST",
            body: toCreateRulePayloadForAction({
              target,
              date: intent.date,
              timeRange: intent.timeRange,
              recurring: intent.recurring,
              reason: intent.reason,
            }),
            headers: {
              "x-actor": context.userId,
              "x-idempotency-key": idempotencyKey,
            },
          },
        );
        actions.push(action);
        const result = await context.client.createUnavailabilityRule({
          target,
          date: intent.date,
          timeRange: intent.timeRange,
          recurring: intent.recurring,
          reason: intent.reason,
          userId: context.userId,
          idempotencyKey,
        });
        action.status = "completed";
        action.result = result;
        return { actions, data: result };
      }
      case "update_last_unavailability_rule": {
        const target = intent.target
          ? (await resolveIntentRoomIds(context.client, [intent.target]))[0]
          : undefined;
        const idempotencyKey = mutationIdempotencyKey(
          context,
          "update_unavailability_rule",
          {
            ...intent,
            target,
          },
        );
        const action = createAction(
          "update_last_unavailability_rule",
          "planned",
          intent.ruleId
            ? `/api/rules/${encodeURIComponent(intent.ruleId)}`
            : "/api/rules",
          {
            method: intent.ruleId ? "PATCH" : "GET",
            query: intent.ruleId ? undefined : { status: "all" },
            headers: intent.ruleId
              ? {
                  "x-actor": context.userId,
                  "x-idempotency-key": idempotencyKey,
                }
              : undefined,
          },
        );
        actions.push(action);
        const result = await context.client.updateUnavailabilityRule({
          ruleId: intent.ruleId,
          target,
          date: intent.date,
          timeRange: intent.timeRange,
          recurring: intent.recurring,
          reason: intent.reason,
          userId: context.userId,
          idempotencyKey,
        });
        action.status = "completed";
        action.result = result;
        return { actions, data: result };
      }
      case "create_or_update_room": {
        const [resolvedRoom] = context.client.resolveRoomReferences
          ? await context.client
              .resolveRoomReferences([intent.roomId])
              .catch((error) => {
                if (isAgentError(error) && error.type === "not_found") {
                  return [];
                }
                throw error;
              })
          : [];
        const payload = {
          ...toRoomConfigPayload(intent),
          roomId: resolvedRoom?.id ?? normalizeRoomId(intent.roomId),
        };
        const idempotencyKey = mutationIdempotencyKey(
          context,
          "create_or_update_room",
          payload,
        );
        const patchPayload = {
          name: payload.name,
          location: payload.location,
          capacity: payload.capacity,
          type: payload.roomType
            ? toBackendRoomType(payload.roomType)
            : undefined,
          equipment: payload.equipment,
          version: undefined,
        };
        const postPayload = {
          id: payload.roomId,
          name: payload.name ?? payload.roomId.replace(/^room-/, ""),
          location: payload.location ?? "",
          capacity: payload.capacity,
          type: toBackendRoomType(payload.roomType),
          equipment: payload.equipment ?? [],
        };
        const action = createAction(
          "create_or_update_room",
          "planned",
          "/api/rooms",
          {
            method: "GET",
            then: payload.roomId
              ? [
                  {
                    method: "PATCH",
                    endpoint: `/api/rooms/${encodeURIComponent(payload.roomId)}`,
                    body: patchPayload,
                    headers: {
                      "x-actor": context.userId,
                      "x-idempotency-key": idempotencyKey,
                    },
                  },
                  {
                    method: "POST",
                    endpoint: "/api/rooms",
                    body: postPayload,
                    headers: {
                      "x-actor": context.userId,
                      "x-idempotency-key": idempotencyKey,
                    },
                  },
                ]
              : [],
          },
        );
        actions.push(action);
        const result = await context.client.createOrUpdateRoom({
          ...payload,
          userId: context.userId,
          idempotencyKey,
        });
        action.status = "completed";
        action.result = result;
        return { actions, data: result };
      }
      case "create_combined_room": {
        const componentRoomIds = await resolveIntentRoomIds(
          context.client,
          intent.componentRoomIds,
        );
        const combinedRoomId = normalizeRoomId(intent.combinedRoomId);
        const request = {
          ...toCombinedRoomPayload(intent),
          combinedRoomId,
          componentRoomIds,
        };
        const idempotencyKey = mutationIdempotencyKey(
          context,
          "create_combined_room",
          request,
        );
        const action = createAction(
          "create_combined_room",
          "planned",
          "/api/rooms/combined",
          {
            method: "POST",
            body: {
              id: combinedRoomId,
              name: intent.name,
              componentRoomIds,
              capacity: intent.capacity,
              equipment: intent.equipment,
            },
            headers: {
              "x-actor": context.userId,
              "x-idempotency-key": idempotencyKey,
            },
          },
        );
        actions.push(action);
        const result = await context.client.createCombinedRoom({
          ...request,
          userId: context.userId,
          idempotencyKey,
        });
        action.status = "completed";
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
      failedAction.status = "failed";
      failedAction.error = agentError;
    }
    return { actions, error: agentError };
  }
}

function createAction(
  type: string,
  status: AgentAction["status"],
  endpoint: string | undefined,
  payload: unknown,
): AgentAction {
  return {
    type,
    status,
    endpoint,
    payload: compactUndefined(payload),
  };
}

function compactUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => compactUndefined(item)) as T;
  }
  if (!isRecord(value)) {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) {
      result[key] = compactUndefined(nested);
    }
  }
  return result as T;
}

export function createStableIdempotencyKey(
  actionType: string,
  payload: unknown,
): string {
  const digest = createHash("sha256")
    .update(`${actionType}:${stableStringify(payload)}`)
    .digest("hex")
    .slice(0, 32);
  return `agent-${digest}`;
}

function mutationIdempotencyKey(
  context: Pick<OrchestratorContext, "conversationId" | "requestId" | "userId">,
  actionType: string,
  payload: unknown,
): string {
  return createStableIdempotencyKey(actionType, {
    conversationId: context.conversationId ?? "local",
    requestId: context.requestId ?? "implicit",
    userId: context.userId,
    payload,
  });
}

function reservationIdForIdempotencyKey(idempotencyKey: string): string {
  return `reservation-${idempotencyKey}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

async function resolveIntentRoomIds(
  client: BackendBusinessApiClient,
  references: string[],
): Promise<string[]> {
  const needsCatalog = references.some(
    (reference) => !isCanonicalRoomId(reference),
  );
  if (!needsCatalog || !client.resolveRoomReferences) {
    return references.map(normalizeRoomId);
  }
  return (await client.resolveRoomReferences(references)).map(
    (room) => room.id,
  );
}

function toRoomConfigPayload(
  intent: CreateOrUpdateRoomIntent,
): CreateOrUpdateRoomRequest {
  return {
    roomId: intent.roomId,
    name: intent.name,
    location: intent.location,
    capacity: intent.capacity,
    roomType: intent.roomType,
    equipment: intent.equipment,
  };
}

function toCombinedRoomPayload(
  intent: CreateCombinedRoomIntent,
): CreateCombinedRoomRequest {
  return {
    combinedRoomId: intent.combinedRoomId,
    name: intent.name,
    componentRoomIds: intent.componentRoomIds,
    capacity: intent.capacity,
    equipment: intent.equipment,
  };
}

async function findMatchingReservations(
  fetchImpl: typeof fetch,
  baseUrl: string,
  request: CancelBookingRequest,
): Promise<BackendReservation[]> {
  const from = request.date
    ? agentDateTimeToUtc(request.date, request.startTime ?? "00:00")
    : undefined;
  const to = request.date
    ? agentDateTimeToUtc(request.date, request.endTime ?? "24:00")
    : undefined;
  const roomId = request.roomId
    ? await resolveSingleRoomId(fetchImpl, baseUrl, request.roomId)
    : undefined;
  const reservations = expectReservationArray(
    await sendJson<unknown>(
      fetchImpl,
      baseUrl,
      "/api/reservations",
      "GET",
      undefined,
      { from, to, roomId, status: "active" },
    ),
  );

  return reservations.filter(
    (reservation) =>
      (!roomId || reservation.roomId === roomId) &&
      (!request.startTime || reservation.start === from) &&
      (!request.endTime || reservation.end === to) &&
      (!request.title || reservation.title === request.title),
  );
}

function toCreateRulePayload(
  request: CreateUnavailabilityRuleRequest,
): Record<string, unknown> {
  const payload = toCreateRulePayloadForAction(request);
  if (!payload) {
    throw {
      type: "need_clarification",
      message: "一次性不可预约规则需要明确日期。",
    } satisfies AgentError;
  }
  return payload;
}

function toCreateRulePayloadForAction(
  request: CreateUnavailabilityRuleRequest,
): Record<string, unknown> | undefined {
  const targetId = normalizeRoomId(request.target);
  if (request.recurring) {
    return {
      targetType: "room",
      targetId,
      ruleType: "periodic_block",
      reason: request.reason,
      recurrence: JSON.stringify({
        type: "weekly",
        weekdays: request.recurring.daysOfWeek,
        timeStart: request.recurring.timeRange.startTime,
        timeEnd: request.recurring.timeRange.endTime,
      }),
      start: RECURRENCE_START_UTC,
      end: FAR_FUTURE_UTC,
    };
  }
  if (!request.date) {
    return undefined;
  }
  const timeRange = request.timeRange ?? {
    startTime: "00:00",
    endTime: "24:00",
  };
  return {
    targetType: "room",
    targetId,
    ruleType: "one_time_block",
    reason: request.reason,
    start: agentDateTimeToUtc(request.date, timeRange.startTime),
    end: agentDateTimeToUtc(request.date, timeRange.endTime),
  };
}

function toUpdateRulePayload(
  existing: BackendRule,
  request: UpdateUnavailabilityRuleRequest,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    version: existing.version,
    reason: request.reason,
    targetId: request.target ? normalizeRoomId(request.target) : undefined,
  };
  if (request.recurring) {
    return {
      ...patch,
      ruleType: "periodic_block",
      recurrence: JSON.stringify({
        type: "weekly",
        weekdays: request.recurring.daysOfWeek,
        timeStart: request.recurring.timeRange.startTime,
        timeEnd: request.recurring.timeRange.endTime,
      }),
      start: RECURRENCE_START_UTC,
      end: FAR_FUTURE_UTC,
    };
  }
  if (request.date || request.timeRange) {
    const current = toAgentRule(existing);
    const date = request.date ?? current.date;
    const timeRange = request.timeRange ?? current.timeRange;
    if (!date || !timeRange) {
      throw {
        type: "need_clarification",
        message: "一次性规则更新需要明确日期和时间范围。",
      } satisfies AgentError;
    }
    return {
      ...patch,
      ruleType: "one_time_block",
      start: agentDateTimeToUtc(date, timeRange.startTime),
      end: agentDateTimeToUtc(date, timeRange.endTime),
    };
  }
  return patch;
}

function toAgentRoom(room: BackendRoom): Room {
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    capacity: room.capacity,
    location: room.location,
    equipment: room.equipment,
    enabled: room.enabled,
    openStart: room.openStart,
    openEnd: room.openEnd,
    version: room.version,
    componentRoomIds: room.componentRoomIds,
  };
}

function toAgentBooking(reservation: BackendReservation): Booking {
  const start = toShanghaiParts(reservation.start);
  const end = toShanghaiParts(reservation.end);
  return {
    id: reservation.id,
    title: reservation.title,
    description: reservation.description,
    roomId: reservation.roomId,
    date: start.date,
    startTime: start.time,
    endTime:
      start.date !== end.date && end.time === "00:00" ? "24:00" : end.time,
    status: reservation.status,
    version: reservation.version,
  };
}

function toAgentRule(rule: BackendRule): UnavailabilityRule {
  if (rule.ruleType === "periodic_block") {
    const recurrence = parseRecurrence(rule.recurrence);
    return {
      id: rule.id,
      target: rule.targetId,
      recurring: recurrence
        ? {
            daysOfWeek: recurrence.weekdays,
            timeRange: {
              startTime: recurrence.timeStart,
              endTime: recurrence.timeEnd,
            },
          }
        : undefined,
      reason: rule.reason,
      enabled: rule.enabled,
      version: rule.version,
    };
  }

  const start = toShanghaiParts(rule.start);
  const end = toShanghaiParts(rule.end);
  return {
    id: rule.id,
    target: rule.targetId,
    date: start.date,
    timeRange: {
      startTime: start.time,
      endTime:
        start.date !== end.date && end.time === "00:00" ? "24:00" : end.time,
    },
    reason: rule.reason,
    enabled: rule.enabled,
    version: rule.version,
  };
}

function agentDateTimeToUtc(date: string, time: string): string {
  if (time === "24:00") {
    const startOfDay = combineLocalDateTime(date, "00:00");
    return new Date(
      new Date(startOfDay).getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();
  }
  return combineLocalDateTime(date, time);
}

function toShanghaiParts(value: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    time: `${part("hour")}:${part("minute")}`,
  };
}

function normalizeRoomId(value: string): string {
  const normalized = value.trim();
  const aliases: Record<string, string> = {
    活动室: "room-activity",
    会议室一: "room-meeting-1",
    会议室二: "room-meeting-2",
    组合会议室: "room-combined",
  };
  if (aliases[normalized]) {
    return aliases[normalized];
  }
  if (/^\d{3,}$/.test(normalized)) {
    return `room-${normalized}`;
  }
  return normalized.startsWith("room-") ? normalized : `room-${normalized}`;
}

function isCanonicalRoomId(value: string): boolean {
  return /^room-[a-z0-9][a-z0-9_-]*$/i.test(value.trim());
}

export interface ResolveRoomReferenceOptions {
  allowNotFound?: boolean;
}

export function resolveRoomReference<T extends Room | BackendRoom>(
  reference: string,
  rooms: T[],
  options: ResolveRoomReferenceOptions = {},
): T | undefined {
  const raw = reference.trim();
  const canonicalId = normalizeRoomId(raw).toLowerCase();
  const normalizedReference = normalizeRoomLookup(raw);
  const exact = rooms.filter(
    (room) =>
      room.id.toLowerCase() === raw.toLowerCase() ||
      room.id.toLowerCase() === canonicalId ||
      room.name.trim().toLowerCase() === raw.toLowerCase(),
  );
  const fuzzy =
    exact.length > 0
      ? exact
      : rooms.filter((room) => {
          const aliases = roomReferenceAliases(room);
          return (
            aliases.has(normalizedReference) ||
            (normalizedReference.length >= 2 &&
              [...aliases].some(
                (alias) =>
                  alias.includes(normalizedReference) ||
                  normalizedReference.includes(alias),
              ))
          );
        });
  const candidates = uniqueRooms(fuzzy);

  if (candidates.length === 1) {
    return candidates[0];
  }
  if (candidates.length > 1) {
    throw {
      type: "need_clarification",
      message: `房间“${reference}”有多个匹配，请明确房间 ID 或完整名称。`,
      details: {
        rooms: candidates.map((room) => ({
          id: room.id,
          name: room.name,
          location: room.location,
        })),
      },
    } satisfies AgentError;
  }
  if (options.allowNotFound) {
    return undefined;
  }
  throw {
    type: "not_found",
    message: `没有找到房间“${reference}”。`,
  } satisfies AgentError;
}

async function resolveSingleRoomId(
  fetchImpl: typeof fetch,
  baseUrl: string,
  reference: string,
): Promise<string> {
  if (isCanonicalRoomId(reference)) {
    return reference.trim();
  }
  const [room] = await resolveRoomIds(fetchImpl, baseUrl, [reference]);
  return room.id;
}

async function resolveRoomIds(
  fetchImpl: typeof fetch,
  baseUrl: string,
  references: string[],
): Promise<BackendRoom[]> {
  if (references.every(isCanonicalRoomId)) {
    return references.map((id) => ({
      id: id.trim(),
      name: id.trim(),
      type: "unknown",
      capacity: 1,
      location: "",
    }));
  }
  const rooms = expectRoomArray(
    await sendJson<unknown>(fetchImpl, baseUrl, "/api/rooms", "GET"),
  );
  return references.map((reference) => {
    if (isCanonicalRoomId(reference)) {
      return (
        rooms.find((room) => room.id === reference.trim()) ?? {
          id: reference.trim(),
          name: reference.trim(),
          type: "unknown",
          capacity: 1,
          location: "",
        }
      );
    }
    return resolveRoomReference(reference, rooms) as BackendRoom;
  });
}

function normalizeRoomLookup(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^room[-_]/, "")
    .replace(/会议室|房间|室/g, "")
    .replace(/[\s_-]+/g, "");
}

function roomReferenceAliases(room: Room | BackendRoom): Set<string> {
  const aliases = new Set([
    normalizeRoomLookup(room.id),
    normalizeRoomLookup(room.name),
  ]);
  if (room.id === "room-activity") {
    aliases.add(normalizeRoomLookup("活动室"));
    aliases.add(normalizeRoomLookup("多功能空间"));
  }
  if (room.id === "room-combined") {
    aliases.add(normalizeRoomLookup("组合会议室"));
  }
  return aliases;
}

function uniqueRooms<T extends Room | BackendRoom>(rooms: T[]): T[] {
  return [...new Map(rooms.map((room) => [room.id, room])).values()];
}

function toBackendRoomType(type?: string): string {
  const types: Record<string, string> = {
    activity: "多功能空间",
    combined: "组合会议室",
    small: "小会议室",
    medium: "标准会议室",
    large: "标准会议室",
  };
  return type ? (types[type] ?? type) : "标准会议室";
}

function matchesAgentRoomType(type: string, requestedType: string): boolean {
  if (requestedType === "small") {
    return type === "小会议室";
  }
  if (requestedType === "activity") {
    return type === "多功能空间";
  }
  if (requestedType === "combined") {
    return type === "组合会议室";
  }
  return type === "标准会议室";
}

function parseRecurrence(value?: string):
  | {
      weekdays: number[];
      timeStart: string;
      timeEnd: string;
    }
  | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (
      Array.isArray(parsed.weekdays) &&
      parsed.weekdays.every((weekday) => typeof weekday === "number") &&
      typeof parsed.timeStart === "string" &&
      typeof parsed.timeEnd === "string"
    ) {
      return {
        weekdays: parsed.weekdays as number[],
        timeStart: parsed.timeStart,
        timeEnd: parsed.timeEnd,
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function sendJson<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
  query?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  const url =
    query && method !== "DELETE"
      ? appendQuery(`${baseUrl}${path}`, query)
      : `${baseUrl}${path}`;

  const response = await fetchImpl(url, {
    method,
    headers:
      body === undefined && headers === undefined
        ? undefined
        : {
            ...headers,
            ...(body === undefined
              ? {}
              : { "Content-Type": "application/json" }),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseJsonBody<BackendBusinessApiErrorBody | T>(
    response,
  );
  if (!response.ok) {
    throw toAgentHttpError(response, payload);
  }

  return payload as T;
}

interface ResilientFetchOptions {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
}

function createResilientFetch(
  fetchImpl: typeof fetch,
  options: ResilientFetchOptions,
): typeof fetch {
  return (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const method = (init?.method ?? "GET").toUpperCase();
    const retrySafe =
      method === "GET" || method === "HEAD" || headers.has("x-idempotency-key");
    const attempts = retrySafe ? options.maxRetries + 1 : 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      const abortFromCaller = () => controller.abort();
      init?.signal?.addEventListener("abort", abortFromCaller, { once: true });
      try {
        const response = await fetchImpl(input, {
          ...init,
          signal: controller.signal,
        });
        if (!isRetryableStatus(response.status) || attempt === attempts) {
          return response;
        }
        await response.arrayBuffer().catch(() => undefined);
        lastError = new Error(
          `Backend API request failed with retryable status ${response.status}.`,
        );
      } catch (error) {
        lastError = error;
        if (attempt === attempts) {
          throw toTransportAgentError(error, options.timeoutMs);
        }
      } finally {
        clearTimeout(timeout);
        init?.signal?.removeEventListener("abort", abortFromCaller);
      }
      await delay(options.retryBaseDelayMs * 2 ** (attempt - 1));
    }

    throw toTransportAgentError(lastError, options.timeoutMs);
  }) as typeof fetch;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function toTransportAgentError(error: unknown, timeoutMs: number): AgentError {
  const timedOut = error instanceof Error && error.name === "AbortError";
  return {
    type: "backend_unavailable",
    message: timedOut
      ? `Backend API request timed out after ${timeoutMs}ms.`
      : "Backend API request failed.",
    details:
      error instanceof Error
        ? { name: error.name, message: error.message }
        : undefined,
  };
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}

function mutationHeaders(
  userId?: string,
  idempotencyKey?: string,
): Record<string, string> {
  return {
    ...(userId ? { "x-actor": userId } : {}),
    ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
  };
}

function expectRoomArray(value: unknown): BackendRoom[] {
  if (!Array.isArray(value) || !value.every(isBackendRoom)) {
    throw invalidBackendResponse("room array");
  }
  return value;
}

function expectRoom(value: unknown): BackendRoom {
  if (!isBackendRoom(value)) {
    throw invalidBackendResponse("room");
  }
  return value;
}

function expectReservationArray(value: unknown): BackendReservation[] {
  if (!Array.isArray(value) || !value.every(isBackendReservation)) {
    throw invalidBackendResponse("reservation array");
  }
  return value;
}

function expectReservation(value: unknown): BackendReservation {
  if (!isBackendReservation(value)) {
    throw invalidBackendResponse("reservation");
  }
  return value;
}

function expectRule(value: unknown): BackendRule {
  if (!isBackendRule(value)) {
    throw invalidBackendResponse("rule");
  }
  return value;
}

function isBackendRoom(value: unknown): value is BackendRoom {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim() !== "" &&
    typeof value.name === "string" &&
    value.name.trim() !== "" &&
    typeof value.type === "string" &&
    typeof value.capacity === "number" &&
    Number.isFinite(value.capacity) &&
    typeof value.location === "string" &&
    (value.equipment === undefined ||
      (Array.isArray(value.equipment) &&
        value.equipment.every((item) => typeof item === "string"))) &&
    (value.componentRoomIds === undefined ||
      (Array.isArray(value.componentRoomIds) &&
        value.componentRoomIds.every((item) => typeof item === "string")))
  );
}

function isBackendReservation(value: unknown): value is BackendReservation {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim() !== "" &&
    typeof value.title === "string" &&
    typeof value.roomId === "string" &&
    isIsoDateTime(value.start) &&
    isIsoDateTime(value.end) &&
    (value.status === "active" || value.status === "cancelled")
  );
}

function isBackendRule(value: unknown): value is BackendRule {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim() !== "" &&
    (value.targetType === "room" || value.targetType === "resource") &&
    typeof value.targetId === "string" &&
    typeof value.ruleType === "string" &&
    typeof value.reason === "string" &&
    isIsoDateTime(value.start) &&
    isIsoDateTime(value.end) &&
    typeof value.updatedAt === "string"
  );
}

function isIsoDateTime(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function invalidBackendResponse(expected: string): AgentError {
  return {
    type: "backend_unavailable",
    message: `Backend API returned an invalid ${expected} response.`,
  };
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
  if (text.trim() === "") {
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
  const errorPayload =
    isRecord(payload) && isRecord(payload.error) ? payload.error : undefined;
  const code =
    typeof errorPayload?.code === "string" ? errorPayload.code : undefined;
  const message =
    typeof errorPayload?.message === "string"
      ? errorPayload.message
      : `Backend API request failed with ${response.status}.`;
  const conflicts = Array.isArray(errorPayload?.conflicts)
    ? errorPayload.conflicts
    : undefined;

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

function mapAgentErrorType(status: number, code?: string): AgentError["type"] {
  if (
    status === 401 ||
    status === 403 ||
    code === "PERMISSION_DENIED" ||
    code === "FORBIDDEN"
  ) {
    return "permission_denied";
  }

  if (
    status === 409 ||
    code === "RESERVATION_CONFLICT" ||
    code === "RULE_BLOCKED" ||
    code === "OUTSIDE_OPEN_HOURS" ||
    code === "VERSION_CONFLICT" ||
    code === "IDEMPOTENCY_CONFLICT"
  ) {
    return "conflict";
  }

  if (status === 404 || code === "NOT_FOUND") {
    return "not_found";
  }

  if (status >= 500 || status === 0) {
    return "backend_unavailable";
  }

  return "backend_unavailable";
}

function mapBackendError(error: unknown): AgentError {
  if (isAgentError(error)) {
    return error;
  }

  return {
    type: "backend_unavailable",
    message:
      error instanceof Error ? error.message : "Backend API request failed.",
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
    (type === "need_clarification" ||
      type === "permission_denied" ||
      type === "conflict" ||
      type === "not_found" ||
      type === "backend_unavailable" ||
      type === "parse_failed") &&
    typeof message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled AgentIntent type: ${String(value)}`);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
