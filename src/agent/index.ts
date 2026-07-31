/**
 * Agent module public exports.
 *
 * RFC-0002: Meeting Room Agent Orchestrator
 */

export type {
  AgentAction,
  AgentError,
  AgentErrorType,
  AgentIntent,
  AgentIntentBase,
  AgentIntentType,
  AgentTimeRange,
  AvailabilityFilters,
  CancelBookingIntent,
  CreateBookingIntent,
  CreateCombinedRoomIntent,
  CreateOrUpdateRoomIntent,
  CreateUnavailabilityRuleIntent,
  NeedClarificationIntent,
  QueryAvailableRoomsIntent,
  UpdateLastUnavailabilityRuleIntent,
  WeeklyRecurringRule,
} from "./types.js";

export type {
  NormalizedDateExpression,
  NormalizedTimeRange,
  NormalizedTimeRangeExpression,
  NormalizeTimeOptions,
  TimeExpressionParts,
} from "./time.js";

export {
  extractDateAndTimeExpression,
  normalizeDateExpression,
  normalizeIntentTimeFields,
  normalizeTimeRangeExpression,
} from "./time.js";

export { parseAgentIntent, validateAgentIntent } from "./schema.js";
export {
  createNexLLMClient,
  type NexLLMClientConfig,
  type NexParserRequest,
  type NexParserResult,
} from "./nex.js";

export {
  createBusinessApiClient,
  createStableIdempotencyKey,
  orchestrateAgentIntent,
  resolveRoomReference,
  type AvailabilityCheckRequest,
  type AvailabilityCheckResult,
  type BackendBusinessApiClient,
  type BackendBusinessApiErrorBody,
  type BackendRoom,
  type BookingResult,
  type ConflictDetail,
  type CreateBookingRequest,
  type CancelBookingRequest,
  type ConflictCheckRequest,
  type CreateBusinessApiClientOptions,
  type CreateCombinedRoomRequest,
  type CreateOrUpdateRoomRequest,
  type CreateUnavailabilityRuleRequest,
  type OrchestratorContext,
  type OrchestratorResult,
  type RoomResult,
  type ResolveRoomReferenceOptions,
  type UnavailabilityRuleResult,
} from "./businessApi.js";

export {
  formatAgentMessage,
  type AgentMessageResponse,
  type FormatAgentMessageOptions,
  type FormatAgentMessageResult,
} from "./formatter.js";
