/**
 * JSON Schema validation utilities for AgentIntent payloads.
 *
 * RFC-0002: Meeting Room Agent Orchestrator
 *
 * The LLM parser must return strict JSON. This validator rejects malformed JSON,
 * unknown intent values, missing required fields, and invalid enum values before
 * the orchestrator calls backend APIs.
 */

import type { AgentError, AgentIntent } from "./types.js";
import {
  normalizeIntentTimeFields,
  type NormalizeTimeOptions,
} from "./time.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const END_OF_DAY_TIME = "24:00";
const INTENT_TYPES = new Set([
  "query_available_rooms",
  "create_booking",
  "cancel_booking",
  "create_unavailability_rule",
  "update_last_unavailability_rule",
  "create_or_update_room",
  "create_combined_room",
  "need_clarification",
]);
const ROOM_TYPES = new Set(["small", "medium", "large", "activity"]);
const ALL_ROOM_TYPES = new Set([...ROOM_TYPES, "combined"]);
const DAYS_OF_WEEK = new Set([0, 1, 2, 3, 4, 5, 6]);
const INTENT_FIELDS: Record<AgentIntent["type"], ReadonlySet<string>> = {
  query_available_rooms: new Set(["type", "date", "timeRange", "filters"]),
  create_booking: new Set([
    "type",
    "roomId",
    "date",
    "timeRange",
    "title",
    "description",
    "attendees",
  ]),
  cancel_booking: new Set([
    "type",
    "bookingId",
    "roomId",
    "date",
    "timeRange",
    "title",
    "confirmationRequired",
  ]),
  create_unavailability_rule: new Set([
    "type",
    "target",
    "date",
    "timeRange",
    "recurring",
    "reason",
  ]),
  update_last_unavailability_rule: new Set([
    "type",
    "ruleId",
    "target",
    "date",
    "timeRange",
    "recurring",
    "reason",
  ]),
  create_or_update_room: new Set([
    "type",
    "roomId",
    "name",
    "location",
    "capacity",
    "roomType",
    "equipment",
  ]),
  create_combined_room: new Set([
    "type",
    "combinedRoomId",
    "name",
    "componentRoomIds",
    "capacity",
    "equipment",
  ]),
  need_clarification: new Set(["type", "missingFields", "clarification"]),
};
const FILTER_FIELDS = new Set([
  "roomType",
  "minCapacity",
  "equipment",
  "combinedRoom",
]);
const TIME_RANGE_FIELDS = new Set(["startTime", "endTime"]);
const RECURRING_FIELDS = new Set(["daysOfWeek", "timeRange"]);
const CLARIFICATION_FIELDS = new Set([
  "date",
  "startTime",
  "endTime",
  "roomId",
  "target",
  "bookingId",
  "timeRange",
  "title",
  "reason",
  "componentRoomIds",
]);

/**
 * Parse and validate an LLM response as an AgentIntent.
 *
 * RFC-0002: parse_failed is returned for malformed JSON or schema violations.
 */
export function parseAgentIntent(
  raw: unknown,
  timeOptions: NormalizeTimeOptions = {},
): { intent?: AgentIntent; error?: AgentError } {
  if (typeof raw !== "string") {
    return {
      error: {
        type: "parse_failed",
        message: "LLM parser response must be a JSON string.",
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      error: {
        type: "parse_failed",
        message: "LLM parser response is not valid JSON.",
        details: error instanceof Error ? error.message : undefined,
      },
    };
  }

  if (!isRecord(parsed)) {
    return {
      error: {
        type: "parse_failed",
        message: "AgentIntent must be a JSON object.",
      },
    };
  }

  const normalized = normalizeIntentTimeFields(parsed, {
    timeZone: timeOptions.timeZone ?? process.env.MEETING_ROOM_TIME_ZONE,
    today: timeOptions.today,
  });
  if (!normalized.valid) {
    return {
      error: {
        type: "parse_failed",
        message: normalized.error.message,
      },
    };
  }

  const validation = validateAgentIntent(normalized.intent);
  if (!validation.valid) {
    return { error: validation.error };
  }

  return { intent: validation.intent };
}

/**
 * Validate an already-parsed AgentIntent object.
 */
export function validateAgentIntent(
  value: unknown,
): { valid: true; intent: AgentIntent } | { valid: false; error: AgentError } {
  if (!isRecord(value)) {
    return validationError("AgentIntent must be a JSON object.");
  }

  if (!isIntentType(value.type)) {
    return validationError(`Unsupported intent type: ${String(value.type)}.`);
  }

  const type = value.type;
  const unknownFields = Object.keys(value).filter(
    (field) => !INTENT_FIELDS[type].has(field),
  );
  if (unknownFields.length > 0) {
    return validationError(
      `${type} contains unknown field(s): ${unknownFields.join(", ")}.`,
    );
  }

  switch (type) {
    case "query_available_rooms":
      return validateQueryAvailableRoomsIntent(value);
    case "create_booking":
      return validateCreateBookingIntent(value);
    case "cancel_booking":
      return validateCancelBookingIntent(value);
    case "create_unavailability_rule":
      return validateCreateUnavailabilityRuleIntent(value);
    case "update_last_unavailability_rule":
      return validateUpdateLastUnavailabilityRuleIntent(value);
    case "create_or_update_room":
      return validateCreateOrUpdateRoomIntent(value);
    case "create_combined_room":
      return validateCreateCombinedRoomIntent(value);
    case "need_clarification":
      return validateNeedClarificationIntent(value);
    default:
      return assertNever(type);
  }
}

function castAgentIntent(value: Record<string, unknown>): AgentIntent {
  return value as unknown as AgentIntent;
}

function validateQueryAvailableRoomsIntent(
  value: Record<string, unknown>,
): { valid: true; intent: AgentIntent } | { valid: false; error: AgentError } {
  const required = requireFields(value, ["date", "timeRange"]);
  if (!required.valid) {
    return required;
  }

  const dateValidation = validateDateString(value.date, "date");
  if (!dateValidation.valid) {
    return dateValidation;
  }

  const timeRangeValidation = validateTimeRange(value.timeRange, "timeRange");
  if (!timeRangeValidation.valid) {
    return timeRangeValidation;
  }

  if (value.filters !== undefined) {
    const filtersValidation = validateAvailabilityFilters(value.filters);
    if (!filtersValidation.valid) {
      return filtersValidation;
    }
  }

  return { valid: true, intent: castAgentIntent(value) };
}

function validateCreateBookingIntent(
  value: Record<string, unknown>,
): { valid: true; intent: AgentIntent } | { valid: false; error: AgentError } {
  const required = requireFields(value, ["roomId", "date", "timeRange"]);
  if (!required.valid) {
    return required;
  }

  if (typeof value.roomId !== "string" || value.roomId.trim() === "") {
    return validationError("create_booking.roomId must be a non-empty string.");
  }

  const dateValidation = validateDateString(value.date, "create_booking.date");
  if (!dateValidation.valid) {
    return dateValidation;
  }

  const timeRangeValidation = validateTimeRange(
    value.timeRange,
    "create_booking.timeRange",
  );
  if (!timeRangeValidation.valid) {
    return timeRangeValidation;
  }

  if (value.title !== undefined && !isNonEmptyString(value.title)) {
    return validationError(
      "create_booking.title must be a non-empty string when provided.",
    );
  }

  if (
    value.description !== undefined &&
    typeof value.description !== "string"
  ) {
    return validationError(
      "create_booking.description must be a string when provided.",
    );
  }

  if (value.attendees !== undefined) {
    const attendeesValidation = validatePositiveInteger(
      value.attendees,
      "create_booking.attendees",
    );
    if (!attendeesValidation.valid) {
      return attendeesValidation;
    }
  }

  return { valid: true, intent: castAgentIntent(value) };
}

function validateCancelBookingIntent(
  value: Record<string, unknown>,
): { valid: true; intent: AgentIntent } | { valid: false; error: AgentError } {
  const hasStableId = isNonEmptyString(value.bookingId);
  const hasCandidateScope =
    value.date !== undefined &&
    (value.roomId !== undefined ||
      value.timeRange !== undefined ||
      value.title !== undefined);
  if (!hasStableId && !hasCandidateScope) {
    return validationError(
      "cancel_booking must include bookingId or date plus roomId, timeRange, or title to identify candidates safely.",
    );
  }

  if (value.bookingId !== undefined && !isNonEmptyString(value.bookingId)) {
    return validationError(
      "cancel_booking.bookingId must be a non-empty string when provided.",
    );
  }

  if (value.roomId !== undefined && !isNonEmptyString(value.roomId)) {
    return validationError(
      "cancel_booking.roomId must be a non-empty string when provided.",
    );
  }

  if (value.date !== undefined) {
    const dateValidation = validateDateString(
      value.date,
      "cancel_booking.date",
    );
    if (!dateValidation.valid) {
      return dateValidation;
    }
  }

  if (value.timeRange !== undefined) {
    const timeRangeValidation = validateTimeRange(
      value.timeRange,
      "cancel_booking.timeRange",
    );
    if (!timeRangeValidation.valid) {
      return timeRangeValidation;
    }
  }

  if (value.title !== undefined && typeof value.title !== "string") {
    return validationError(
      "cancel_booking.title must be a string when provided.",
    );
  }

  if (
    value.confirmationRequired !== undefined &&
    typeof value.confirmationRequired !== "boolean"
  ) {
    return validationError(
      "cancel_booking.confirmationRequired must be a boolean when provided.",
    );
  }

  return { valid: true, intent: castAgentIntent(value) };
}

function validateCreateUnavailabilityRuleIntent(
  value: Record<string, unknown>,
): { valid: true; intent: AgentIntent } | { valid: false; error: AgentError } {
  const required = requireFields(value, ["target", "reason"]);
  if (!required.valid) {
    return required;
  }

  if (!isNonEmptyString(value.target)) {
    return validationError(
      "create_unavailability_rule.target must be a non-empty string.",
    );
  }

  if (!isNonEmptyString(value.reason)) {
    return validationError(
      "create_unavailability_rule.reason must be a non-empty string.",
    );
  }

  if (value.date !== undefined) {
    const dateValidation = validateDateString(
      value.date,
      "create_unavailability_rule.date",
    );
    if (!dateValidation.valid) {
      return dateValidation;
    }
  }

  if (value.timeRange !== undefined) {
    const timeRangeValidation = validateTimeRange(
      value.timeRange,
      "create_unavailability_rule.timeRange",
    );
    if (!timeRangeValidation.valid) {
      return timeRangeValidation;
    }
  }

  if (value.recurring !== undefined) {
    const recurringValidation = validateWeeklyRecurringRule(value.recurring);
    if (!recurringValidation.valid) {
      return recurringValidation;
    }
  }

  if (value.date !== undefined && value.recurring !== undefined) {
    return validationError(
      "create_unavailability_rule cannot include both date and recurring.",
    );
  }

  if (value.date === undefined && value.recurring === undefined) {
    return validationError(
      "create_unavailability_rule must include either date or recurring.",
    );
  }

  return { valid: true, intent: castAgentIntent(value) };
}

function validateUpdateLastUnavailabilityRuleIntent(
  value: Record<string, unknown>,
): { valid: true; intent: AgentIntent } | { valid: false; error: AgentError } {
  if (
    !hasAnyField(value, ["target", "date", "timeRange", "recurring", "reason"])
  ) {
    return validationError(
      "update_last_unavailability_rule must include at least one field to update.",
    );
  }

  if (value.ruleId !== undefined && !isNonEmptyString(value.ruleId)) {
    return validationError(
      "update_last_unavailability_rule.ruleId must be a non-empty string when provided.",
    );
  }

  if (value.target !== undefined && !isNonEmptyString(value.target)) {
    return validationError(
      "update_last_unavailability_rule.target must be a non-empty string when provided.",
    );
  }

  if (value.date !== undefined) {
    const dateValidation = validateDateString(
      value.date,
      "update_last_unavailability_rule.date",
    );
    if (!dateValidation.valid) {
      return dateValidation;
    }
  }

  if (value.timeRange !== undefined) {
    const timeRangeValidation = validateTimeRange(
      value.timeRange,
      "update_last_unavailability_rule.timeRange",
    );
    if (!timeRangeValidation.valid) {
      return timeRangeValidation;
    }
  }

  if (value.recurring !== undefined) {
    const recurringValidation = validateWeeklyRecurringRule(value.recurring);
    if (!recurringValidation.valid) {
      return recurringValidation;
    }
  }

  if (value.reason !== undefined && !isNonEmptyString(value.reason)) {
    return validationError(
      "update_last_unavailability_rule.reason must be a non-empty string when provided.",
    );
  }

  if (value.date !== undefined && value.recurring !== undefined) {
    return validationError(
      "update_last_unavailability_rule cannot include both date and recurring.",
    );
  }

  return { valid: true, intent: castAgentIntent(value) };
}

function validateCreateOrUpdateRoomIntent(
  value: Record<string, unknown>,
): { valid: true; intent: AgentIntent } | { valid: false; error: AgentError } {
  const required = requireFields(value, ["roomId"]);
  if (!required.valid) {
    return required;
  }

  if (!isNonEmptyString(value.roomId)) {
    return validationError(
      "create_or_update_room.roomId must be a non-empty string.",
    );
  }

  if (value.name !== undefined && !isNonEmptyString(value.name)) {
    return validationError(
      "create_or_update_room.name must be a non-empty string when provided.",
    );
  }

  if (value.location !== undefined && typeof value.location !== "string") {
    return validationError(
      "create_or_update_room.location must be a string when provided.",
    );
  }

  if (value.capacity !== undefined) {
    const capacityValidation = validatePositiveInteger(
      value.capacity,
      "create_or_update_room.capacity",
    );
    if (!capacityValidation.valid) {
      return capacityValidation;
    }
  }

  if (value.roomType !== undefined && !ROOM_TYPES.has(String(value.roomType))) {
    return validationError(
      "create_or_update_room.roomType must be one of small, medium, large, activity.",
    );
  }

  if (value.equipment !== undefined) {
    const equipmentValidation = validateStringArray(
      value.equipment,
      "create_or_update_room.equipment",
    );
    if (!equipmentValidation.valid) {
      return equipmentValidation;
    }
  }

  if (
    !hasAnyField(value, [
      "name",
      "location",
      "capacity",
      "roomType",
      "equipment",
    ])
  ) {
    return validationError(
      "create_or_update_room must include at least one room field to create or update.",
    );
  }

  return { valid: true, intent: castAgentIntent(value) };
}

function validateCreateCombinedRoomIntent(
  value: Record<string, unknown>,
): { valid: true; intent: AgentIntent } | { valid: false; error: AgentError } {
  const required = requireFields(value, ["combinedRoomId", "componentRoomIds"]);
  if (!required.valid) {
    return required;
  }

  if (!isNonEmptyString(value.combinedRoomId)) {
    return validationError(
      "create_combined_room.combinedRoomId must be a non-empty string.",
    );
  }

  const componentsValidation = validateStringArray(
    value.componentRoomIds,
    "create_combined_room.componentRoomIds",
  );
  if (!componentsValidation.valid) {
    return componentsValidation;
  }

  if (
    new Set(value.componentRoomIds as string[]).size !==
    (value.componentRoomIds as string[]).length
  ) {
    return validationError(
      "create_combined_room.componentRoomIds must not contain duplicates.",
    );
  }

  if ((value.componentRoomIds as string[]).length < 2) {
    return validationError(
      "create_combined_room.componentRoomIds must contain at least two rooms.",
    );
  }

  const normalizedCombinedId = normalizeReferenceForComparison(
    value.combinedRoomId as string,
  );
  if (
    (value.componentRoomIds as string[]).some(
      (component) =>
        normalizeReferenceForComparison(component) === normalizedCombinedId,
    )
  ) {
    return validationError(
      "create_combined_room.componentRoomIds must not contain the combined room itself.",
    );
  }

  if (value.name !== undefined && !isNonEmptyString(value.name)) {
    return validationError(
      "create_combined_room.name must be a non-empty string when provided.",
    );
  }

  if (value.capacity !== undefined) {
    const capacityValidation = validatePositiveInteger(
      value.capacity,
      "create_combined_room.capacity",
    );
    if (!capacityValidation.valid) {
      return capacityValidation;
    }
  }

  if (value.equipment !== undefined) {
    const equipmentValidation = validateStringArray(
      value.equipment,
      "create_combined_room.equipment",
    );
    if (!equipmentValidation.valid) {
      return equipmentValidation;
    }
  }

  return { valid: true, intent: castAgentIntent(value) };
}

function validateNeedClarificationIntent(
  value: Record<string, unknown>,
): { valid: true; intent: AgentIntent } | { valid: false; error: AgentError } {
  const required = requireFields(value, ["missingFields", "clarification"]);
  if (!required.valid) {
    return required;
  }

  if (!Array.isArray(value.missingFields) || value.missingFields.length === 0) {
    return validationError(
      "need_clarification.missingFields must be a non-empty array.",
    );
  }

  if (!value.missingFields.every(isString)) {
    return validationError(
      "need_clarification.missingFields must contain only strings.",
    );
  }

  if (!value.missingFields.every((field) => CLARIFICATION_FIELDS.has(field))) {
    return validationError(
      "need_clarification.missingFields contains an unsupported field.",
    );
  }

  if (!isNonEmptyString(value.clarification)) {
    return validationError(
      "need_clarification.clarification must be a non-empty string.",
    );
  }

  return { valid: true, intent: castAgentIntent(value) };
}

function validateAvailabilityFilters(
  value: unknown,
): { valid: true; intent?: undefined } | { valid: false; error: AgentError } {
  if (!isRecord(value)) {
    return validationError("filters must be an object.");
  }

  const unknownFields = Object.keys(value).filter(
    (field) => !FILTER_FIELDS.has(field),
  );
  if (unknownFields.length > 0) {
    return validationError(
      `filters contains unknown field(s): ${unknownFields.join(", ")}.`,
    );
  }

  if (
    value.roomType !== undefined &&
    !ALL_ROOM_TYPES.has(String(value.roomType))
  ) {
    return validationError(
      "filters.roomType must be one of small, medium, large, activity, combined.",
    );
  }

  if (value.minCapacity !== undefined) {
    const capacityValidation = validatePositiveInteger(
      value.minCapacity,
      "filters.minCapacity",
    );
    if (!capacityValidation.valid) {
      return capacityValidation;
    }
  }

  if (value.equipment !== undefined) {
    const equipmentValidation = validateStringArray(
      value.equipment,
      "filters.equipment",
    );
    if (!equipmentValidation.valid) {
      return equipmentValidation;
    }
  }

  if (
    value.combinedRoom !== undefined &&
    typeof value.combinedRoom !== "boolean"
  ) {
    return validationError(
      "filters.combinedRoom must be a boolean when provided.",
    );
  }

  return { valid: true };
}

function validateWeeklyRecurringRule(
  value: unknown,
): { valid: true; intent?: undefined } | { valid: false; error: AgentError } {
  if (!isRecord(value)) {
    return validationError("recurring must be an object.");
  }

  const unknownFields = Object.keys(value).filter(
    (field) => !RECURRING_FIELDS.has(field),
  );
  if (unknownFields.length > 0) {
    return validationError(
      `recurring contains unknown field(s): ${unknownFields.join(", ")}.`,
    );
  }

  if (!Array.isArray(value.daysOfWeek) || value.daysOfWeek.length === 0) {
    return validationError("recurring.daysOfWeek must be a non-empty array.");
  }

  if (
    !value.daysOfWeek.every(
      (day) => typeof day === "number" && DAYS_OF_WEEK.has(day),
    )
  ) {
    return validationError(
      "recurring.daysOfWeek must contain numbers from 0 to 6.",
    );
  }

  const timeRangeValidation = validateTimeRange(
    value.timeRange,
    "recurring.timeRange",
  );
  if (!timeRangeValidation.valid) {
    return timeRangeValidation;
  }

  return { valid: true };
}

function validateTimeRange(
  value: unknown,
  path: string,
): { valid: true; intent?: undefined } | { valid: false; error: AgentError } {
  if (!isRecord(value)) {
    return validationError(`${path} must be an object.`);
  }

  const unknownFields = Object.keys(value).filter(
    (field) => !TIME_RANGE_FIELDS.has(field),
  );
  if (unknownFields.length > 0) {
    return validationError(
      `${path} contains unknown field(s): ${unknownFields.join(", ")}.`,
    );
  }

  const required = requireFields(value, ["startTime", "endTime"]);
  if (!required.valid) {
    return required;
  }

  const startTimeValidation = validateTimeString(
    value.startTime,
    `${path}.startTime`,
  );
  if (!startTimeValidation.valid) {
    return startTimeValidation;
  }

  const endTimeValidation = validateTimeString(
    value.endTime,
    `${path}.endTime`,
  );
  if (!endTimeValidation.valid) {
    return endTimeValidation;
  }

  if (value.startTime === value.endTime) {
    return validationError(
      `${path}.endTime must be later than ${path}.startTime.`,
    );
  }

  const startMinutes = timeToMinutes(value.startTime);
  const endMinutes = timeToMinutes(value.endTime);
  if (
    startMinutes === undefined ||
    endMinutes === undefined ||
    startMinutes >= endMinutes
  ) {
    return validationError(
      `${path}.endTime must be later than ${path}.startTime.`,
    );
  }

  return { valid: true };
}

function validateDateString(
  value: unknown,
  path: string,
): { valid: true; intent?: undefined } | { valid: false; error: AgentError } {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) {
    return validationError(`${path} must be in YYYY-MM-DD format.`);
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return validationError(`${path} must be a valid calendar date.`);
  }

  return { valid: true };
}

function validateTimeString(
  value: unknown,
  path: string,
): { valid: true; intent?: undefined } | { valid: false; error: AgentError } {
  if (typeof value !== "string") {
    return validationError(`${path} must be in HH:mm format.`);
  }

  if (value === END_OF_DAY_TIME) {
    return { valid: true };
  }

  if (!TIME_PATTERN.test(value)) {
    return validationError(`${path} must be in HH:mm format.`);
  }

  return { valid: true };
}

function validatePositiveInteger(
  value: unknown,
  path: string,
): { valid: true; intent?: undefined } | { valid: false; error: AgentError } {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return validationError(`${path} must be a positive integer.`);
  }

  return { valid: true };
}

function validateStringArray(
  value: unknown,
  path: string,
): { valid: true; intent?: undefined } | { valid: false; error: AgentError } {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(isNonEmptyString)
  ) {
    return validationError(
      `${path} must be a non-empty array of non-empty strings.`,
    );
  }

  return { valid: true };
}

function requireFields(
  value: Record<string, unknown>,
  fields: string[],
): { valid: true } | { valid: false; error: AgentError } {
  const missing = fields.filter((field) => value[field] === undefined);
  if (missing.length > 0) {
    return validationError(`Missing required field(s): ${missing.join(", ")}.`);
  }

  return { valid: true };
}

function hasAnyField(
  value: Record<string, unknown>,
  fields: string[],
): boolean {
  return fields.some((field) => value[field] !== undefined);
}

function isIntentType(value: unknown): value is AgentIntent["type"] {
  return typeof value === "string" && INTENT_TYPES.has(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timeToMinutes(value: unknown): number | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (value === END_OF_DAY_TIME) {
    return 24 * 60;
  }

  const match = TIME_PATTERN.exec(value);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(value.slice(3, 5));
  return hours * 60 + minutes;
}

function validationError(message: string): { valid: false; error: AgentError } {
  return {
    valid: false,
    error: {
      type: "parse_failed",
      message,
    },
  };
}

function normalizeReferenceForComparison(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^room[-_]/, "")
    .replace(/[\s_-]+/g, "");
}

function assertNever(value: never): never {
  throw new Error(`Unhandled intent type: ${String(value)}`);
}
