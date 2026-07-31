/**
 * Agent intent contracts for the meeting-room orchestrator.
 *
 * RFC-0002: Meeting Room Agent Orchestrator
 *
 * These types describe the strict JSON payload returned by the LLM parser before
 * the orchestrator maps it to backend business APIs.
 */

/**
 * Intent type returned by the LLM parser.
 *
 * RFC-0002: Defines the allowed AgentIntent values and their routing semantics.
 */
export type AgentIntentType =
  | "query_available_rooms"
  | "create_booking"
  | "cancel_booking"
  | "create_unavailability_rule"
  | "update_last_unavailability_rule"
  | "create_or_update_room"
  | "create_combined_room"
  | "need_clarification";

/**
 * Error type surfaced by Agent parsing, validation, orchestration, or backend calls.
 *
 * RFC-0002: Error types are stable so the response formatter can explain failures consistently.
 */
export type AgentErrorType =
  | "need_clarification"
  | "permission_denied"
  | "conflict"
  | "not_found"
  | "backend_unavailable"
  | "parse_failed";

/**
 * Time range shared by availability, booking, and unavailability rules.
 *
 * RFC-0002: Time values use `HH:mm` strings; date values use `YYYY-MM-DD`.
 */
export interface AgentTimeRange {
  startTime: string;
  endTime: string;
}

/**
 * Availability filters used by query_available_rooms.
 *
 * RFC-0002: Filters capture room type, capacity, equipment, and combined-room needs.
 */
export interface AvailabilityFilters {
  roomType?: "small" | "medium" | "large" | "activity" | "combined";
  minCapacity?: number;
  equipment?: string[];
  combinedRoom?: boolean;
}

/**
 * Recurring weekly rule definition.
 *
 * RFC-0002: Supports weekly unavailability rules without relying on natural language.
 */
export interface WeeklyRecurringRule {
  daysOfWeek: Array<1 | 2 | 3 | 4 | 5 | 6 | 0>;
  timeRange: AgentTimeRange;
}

/**
 * Base fields common to actionable Agent intents.
 */
export interface AgentIntentBase {
  type: AgentIntentType;
  userId?: string;
}

/**
 * Query available meeting rooms for a date and time range.
 */
export interface QueryAvailableRoomsIntent extends AgentIntentBase {
  type: "query_available_rooms";
  date: string;
  timeRange: AgentTimeRange;
  filters?: AvailabilityFilters;
}

/**
 * Create a booking through the backend booking API.
 */
export interface CreateBookingIntent extends AgentIntentBase {
  type: "create_booking";
  roomId: string;
  date: string;
  timeRange: AgentTimeRange;
  title?: string;
  description?: string;
  attendees?: number;
}

/**
 * Cancel an existing booking.
 */
export interface CancelBookingIntent extends AgentIntentBase {
  type: "cancel_booking";
  bookingId?: string;
  roomId?: string;
  date?: string;
  timeRange?: AgentTimeRange;
  title?: string;
  confirmationRequired?: boolean;
}

/**
 * Create a temporary or recurring unavailability rule.
 */
export interface CreateUnavailabilityRuleIntent extends AgentIntentBase {
  type: "create_unavailability_rule";
  target: string;
  date?: string;
  timeRange?: AgentTimeRange;
  recurring?: WeeklyRecurringRule;
  reason: string;
}

/**
 * Update the last unavailability rule mentioned in the conversation history.
 *
 * RFC-0003 T1: ruleId is accepted when available so the adapter can PATCH the
 * authoritative /api/rules/:ruleId resource instead of a private last-rule endpoint.
 */
export interface UpdateLastUnavailabilityRuleIntent extends AgentIntentBase {
  type: "update_last_unavailability_rule";
  target?: string;
  date?: string;
  timeRange?: AgentTimeRange;
  recurring?: WeeklyRecurringRule;
  reason?: string;
  ruleId?: string;
}

/**
 * Create or update room metadata.
 */
export interface CreateOrUpdateRoomIntent extends AgentIntentBase {
  type: "create_or_update_room";
  roomId: string;
  name?: string;
  location?: string;
  capacity?: number;
  roomType?: "small" | "medium" | "large" | "activity";
  equipment?: string[];
}

/**
 * Create a combined room from component room IDs.
 */
export interface CreateCombinedRoomIntent extends AgentIntentBase {
  type: "create_combined_room";
  combinedRoomId: string;
  name?: string;
  componentRoomIds: string[];
  capacity?: number;
  equipment?: string[];
}

/**
 * Ask the user for missing information before invoking backend APIs.
 */
export interface NeedClarificationIntent extends AgentIntentBase {
  type: "need_clarification";
  missingFields: Array<
    | "date"
    | "startTime"
    | "endTime"
    | "roomId"
    | "target"
    | "bookingId"
    | "timeRange"
    | "title"
    | "reason"
    | "componentRoomIds"
  >;
  clarification: string;
}

/**
 * Union of all strict JSON intents returned by the LLM parser.
 *
 * RFC-0002: Every supported natural-language scenario must map to one of these intents.
 */
export type AgentIntent =
  | QueryAvailableRoomsIntent
  | CreateBookingIntent
  | CancelBookingIntent
  | CreateUnavailabilityRuleIntent
  | UpdateLastUnavailabilityRuleIntent
  | CreateOrUpdateRoomIntent
  | CreateCombinedRoomIntent
  | NeedClarificationIntent;

/**
 * Structured error returned by the Agent layer.
 */
export interface AgentError {
  type: AgentErrorType;
  message: string;
  details?: unknown;
}

/**
 * Action attempted or completed by the Agent orchestrator.
 */
export interface AgentAction {
  type: string;
  status: "planned" | "started" | "completed" | "failed";
  endpoint?: string;
  payload?: unknown;
  result?: unknown;
  error?: AgentError;
}
