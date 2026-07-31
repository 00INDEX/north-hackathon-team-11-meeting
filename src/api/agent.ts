import { randomUUID } from "node:crypto";
import {
  createBusinessApiClient,
  formatAgentMessage,
  orchestrateAgentIntent,
  type AgentAction,
  type AgentError,
  type AgentIntent,
  type AgentMessageResponse,
  type BackendBusinessApiClient,
} from "@/agent/index.js";
import type {
  ConversationHistoryStore,
  ConversationMessage,
} from "@/domain/conversation";
import {
  createNexLLMClient,
  type NexParserRequest,
  type NexParserResult,
} from "@/agent/nex.js";
import {
  createInMemoryConversationHistoryStore,
  sanitizeMetadata,
} from "@/api/history.js";
import { Hono, type Context } from "hono";

export interface AgentMessageRequest {
  conversationId: string;
  message: string;
  requestId?: string;
}

export interface AgentServerAuthContext {
  userId: string;
  role: "member" | "admin";
  authContext: {
    source: "demo" | string;
    role: "member" | "admin";
    [key: string]: unknown;
  };
}

export interface AgentIntentParser {
  parseIntent(request: NexParserRequest): Promise<NexParserResult>;
}

export interface CreateAgentMessageRouteOptions {
  parser?: AgentIntentParser;
  businessApiClient?: BackendBusinessApiClient;
  history?: ConversationHistoryStore;
  resolveAuth?: () => AgentServerAuthContext | Promise<AgentServerAuthContext>;
  createRequestId?: () => string;
}

type AgentResponseStatus = 200 | 400 | 403 | 404 | 409 | 502 | 503;

export function createAgentMessageRoute(
  options: CreateAgentMessageRouteOptions = {},
) {
  const app = new Hono();
  const historyStore =
    options.history ?? createInMemoryConversationHistoryStore();

  app.post("/api/agent/message", async (context) => {
    const bodyResult = await readJsonBody(context.req.raw);
    if (!bodyResult.ok) {
      return context.json(
        formatAgentMessage({ parserError: parseFailed(bodyResult.message) }),
        400,
      );
    }

    const validationError = validateAgentMessageRequest(bodyResult.value);
    if (validationError) {
      return context.json(
        formatAgentMessage({ parserError: validationError }),
        400,
      );
    }

    const body = bodyResult.value as AgentMessageRequest;
    const conversationId = body.conversationId.trim();
    const message = body.message.trim();
    const requestId =
      body.requestId?.trim() || options.createRequestId?.() || randomUUID();

    let auth: AgentServerAuthContext;
    let history: ConversationMessage[];
    try {
      [auth, history] = await Promise.all([
        options.resolveAuth?.() ?? resolveDemoAgentAuth(),
        historyStore.getHistory(conversationId),
      ]);
    } catch {
      return context.json(historyUnavailableResponse(), 503);
    }

    const replay = findReplay(history, requestId, message);
    if (replay) {
      return context.json(replay.response, replay.status);
    }

    let parserResult: NexParserResult;
    try {
      const parser = options.parser ?? createNexLLMClient();
      parserResult = await parser.parseIntent({
        userId: auth.userId,
        conversationId,
        message,
        history: toParserHistory(history),
        authContext: auth.authContext,
      });
    } catch {
      parserResult = {
        error: {
          type: "backend_unavailable",
          message: "Nex LLM parser request failed.",
        },
      };
    }

    if (parserResult.error) {
      const response = formatAgentMessage({ parserError: parserResult.error });
      return persistAndRespond(
        context,
        historyStore,
        auth.userId,
        conversationId,
        requestId,
        message,
        response,
        statusForAgentError(response.error, "parser"),
      );
    }

    const parsedIntent = parserResult.intent
      ? secureAndResolveIntent(parserResult.intent, auth.userId, history)
      : undefined;
    if (
      parsedIntent &&
      requiresDemoAdmin(parsedIntent) &&
      auth.role !== "admin"
    ) {
      const response = formatAgentMessage({
        intent: parsedIntent,
        orchestratorResult: {
          actions: [],
          error: {
            type: "permission_denied",
            message: "当前 Demo 身份没有会议室或规则管理权限。",
          },
        },
      });
      return persistAndRespond(
        context,
        historyStore,
        auth.userId,
        conversationId,
        requestId,
        message,
        response,
        403,
      );
    }
    const businessApiClient =
      options.businessApiClient ?? createBusinessApiClient();
    const orchestratorContext = {
      userId: auth.userId,
      authContext: auth.authContext,
      client: businessApiClient,
      conversationId,
      requestId,
    };
    const orchestratorResult = parsedIntent
      ? await orchestrateAgentIntent(parsedIntent, orchestratorContext)
      : undefined;
    const formatted = formatAgentMessage({
      intent: parsedIntent,
      orchestratorResult,
    });
    const response: AgentMessageResponse = {
      ...formatted,
      actions: sanitizeActions(formatted.actions),
    };

    return persistAndRespond(
      context,
      historyStore,
      auth.userId,
      conversationId,
      requestId,
      message,
      response,
      statusForAgentError(response.error, "orchestrator"),
    );
  });

  return app;
}

export function resolveDemoAgentAuth(
  environment: NodeJS.ProcessEnv = process.env,
): AgentServerAuthContext {
  const userId =
    environment.MEETING_ROOM_DEMO_USER_ID?.trim() ||
    environment.DEMO_USER_ID?.trim() ||
    "local-user";
  const role =
    environment.MEETING_ROOM_DEMO_ROLE?.trim().toLowerCase() === "admin"
      ? "admin"
      : "member";

  return {
    userId,
    role,
    authContext: {
      source: "demo",
      role,
    },
  };
}

export function validateAgentMessagePayload(
  payload: unknown,
): AgentMessageResponse["error"] {
  return validateAgentMessageRequest(payload);
}

function validateAgentMessageRequest(
  body: unknown,
): AgentMessageResponse["error"] {
  if (!isRecord(body)) {
    return parseFailed("Agent message request must be a JSON object.");
  }
  if (!isNonEmptyString(body.conversationId)) {
    return parseFailed("conversationId must be a non-empty string.");
  }
  if (!isNonEmptyString(body.message)) {
    return parseFailed("message must be a non-empty string.");
  }
  if (body.requestId !== undefined && !isNonEmptyString(body.requestId)) {
    return parseFailed("requestId must be a non-empty string when provided.");
  }
  return null;
}

async function persistAndRespond(
  context: Context,
  history: ConversationHistoryStore,
  userId: string,
  conversationId: string,
  requestId: string,
  userContent: string,
  response: AgentMessageResponse,
  status: AgentResponseStatus,
) {
  try {
    await history.appendTurn(
      conversationId,
      {
        role: "user",
        content: userContent,
        requestId,
      },
      {
        role: "assistant",
        content: response.reply,
        requestId,
        parsedIntent: sanitizeMetadata(response.parsedIntent),
        actions: sanitizeMetadata(response.actions),
        result: summarizeResult(response, status),
      },
      userId,
    );
  } catch {
    return context.json(historyUnavailableResponse(), 503);
  }
  return context.json(response, status);
}

function secureAndResolveIntent(
  intent: AgentIntent,
  userId: string,
  history: ConversationMessage[],
): AgentIntent {
  const secured = {
    ...intent,
    userId,
  } as AgentIntent;

  if (secured.type === "update_last_unavailability_rule" && !secured.ruleId) {
    const ruleId = findLatestResourceId(history, "rule");
    return ruleId ? { ...secured, ruleId } : secured;
  }

  if (
    secured.type === "cancel_booking" &&
    !secured.bookingId &&
    !secured.roomId &&
    !secured.date &&
    !secured.title
  ) {
    const bookingId = findLatestResourceId(history, "reservation");
    return bookingId ? { ...secured, bookingId } : secured;
  }

  return secured;
}

function requiresDemoAdmin(intent: AgentIntent): boolean {
  return [
    "create_unavailability_rule",
    "update_last_unavailability_rule",
    "create_or_update_room",
    "create_combined_room",
  ].includes(intent.type);
}

function findLatestResourceId(
  history: ConversationMessage[],
  resource: "rule" | "reservation",
): string | undefined {
  for (
    let messageIndex = history.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = history[messageIndex];
    const summaryId = extractResourceId(message.result, resource);
    if (summaryId) {
      return summaryId;
    }

    if (!Array.isArray(message.actions)) {
      continue;
    }
    for (
      let actionIndex = message.actions.length - 1;
      actionIndex >= 0;
      actionIndex -= 1
    ) {
      const action = message.actions[actionIndex];
      if (!isRecord(action) || action.status !== "completed") {
        continue;
      }
      const expectedType =
        resource === "rule"
          ? ["create_unavailability_rule", "update_last_unavailability_rule"]
          : ["create_booking"];
      if (!expectedType.includes(String(action.type))) {
        continue;
      }
      const actionId = extractResourceId(action.result, resource);
      if (actionId) {
        return actionId;
      }
    }
  }
  return undefined;
}

function summarizeResult(
  response: AgentMessageResponse,
  status: AgentResponseStatus,
): unknown {
  const summary: Record<string, unknown> = {};
  for (const action of response.actions) {
    if (action.status !== "completed") {
      continue;
    }
    const ruleId = extractResourceId(action.result, "rule");
    const reservationId = extractResourceId(action.result, "reservation");
    const roomId = extractRoomId(action.result);
    if (ruleId) {
      summary.ruleId = ruleId;
    }
    if (reservationId) {
      summary.reservationId = reservationId;
    }
    if (roomId) {
      summary.roomId = roomId;
    }
  }
  if (response.error) {
    summary.error = {
      type: response.error.type,
      message: response.error.message,
    };
    summary.httpStatus = status;
  }
  return Object.keys(summary).length > 0 ? summary : undefined;
}

function findReplay(
  history: ConversationMessage[],
  requestId: string,
  currentMessage: string,
): { response: AgentMessageResponse; status: AgentResponseStatus } | undefined {
  const userMessage = history.find(
    (entry) => entry.requestId === requestId && entry.role === "user",
  );
  const assistantMessage = history.find(
    (entry) => entry.requestId === requestId && entry.role === "assistant",
  );
  if (!userMessage || !assistantMessage) {
    return undefined;
  }

  if (userMessage.content !== currentMessage) {
    const error: AgentError = {
      type: "conflict",
      message: "requestId was already used for a different message.",
    };
    return {
      response: formatAgentMessage({ parserError: error }),
      status: 409,
    };
  }

  const result = isRecord(assistantMessage.result)
    ? assistantMessage.result
    : {};
  const error = isAgentError(result.error) ? result.error : null;
  const storedStatus =
    typeof result.httpStatus === "number" ? result.httpStatus : undefined;
  const status = isAgentResponseStatus(storedStatus)
    ? storedStatus
    : statusForAgentError(error, "orchestrator");
  return {
    response: {
      reply: assistantMessage.content,
      parsedIntent: isRecord(assistantMessage.parsedIntent)
        ? (assistantMessage.parsedIntent as unknown as AgentIntent)
        : null,
      actions: Array.isArray(assistantMessage.actions)
        ? (assistantMessage.actions as AgentAction[])
        : [],
      error,
    },
    status,
  };
}

function extractResourceId(
  value: unknown,
  resource: "rule" | "reservation",
): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const directKeys =
    resource === "rule"
      ? ["ruleId", "updatedRuleId"]
      : ["reservationId", "bookingId"];
  for (const key of directKeys) {
    if (isNonEmptyString(value[key])) {
      return value[key].trim();
    }
  }

  const nestedKeys =
    resource === "rule" ? ["rule"] : ["reservation", "booking"];
  for (const key of nestedKeys) {
    const nested = value[key];
    if (isRecord(nested) && isNonEmptyString(nested.id)) {
      return nested.id.trim();
    }
  }
  return undefined;
}

function extractRoomId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (isRecord(value.room) && isNonEmptyString(value.room.id)) {
    return value.room.id.trim();
  }
  return undefined;
}

function toParserHistory(history: ConversationMessage[]) {
  return history.map((message) => ({
    role: message.role,
    content: message.content,
    parsedIntent: message.parsedIntent,
    actions: message.actions,
    result: message.result,
  }));
}

function sanitizeActions(actions: AgentAction[]): AgentAction[] {
  return sanitizeMetadata(actions) as AgentAction[];
}

function statusForAgentError(
  error: AgentError | null,
  source: "parser" | "orchestrator",
): AgentResponseStatus {
  if (
    !error ||
    error.type === "need_clarification" ||
    error.type === "parse_failed"
  ) {
    return 200;
  }
  switch (error.type) {
    case "permission_denied":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
      return 409;
    case "backend_unavailable":
      return source === "parser" ? 502 : 503;
    default:
      return 503;
  }
}

function historyUnavailableResponse(): AgentMessageResponse {
  return formatAgentMessage({
    parserError: {
      type: "backend_unavailable",
      message: "Conversation history service is unavailable.",
    },
  });
}

function parseFailed(message: string): AgentError {
  return {
    type: "parse_failed",
    message,
  };
}

async function readJsonBody(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, message: "Request body must be valid JSON." };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAgentError(value: unknown): value is AgentError {
  return (
    isRecord(value) &&
    [
      "need_clarification",
      "permission_denied",
      "conflict",
      "not_found",
      "backend_unavailable",
      "parse_failed",
    ].includes(String(value.type)) &&
    typeof value.message === "string"
  );
}

function isAgentResponseStatus(value: unknown): value is AgentResponseStatus {
  return [200, 400, 403, 404, 409, 502, 503].includes(Number(value));
}
