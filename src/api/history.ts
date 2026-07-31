import type {
  AppendConversationMessageInput,
  ConversationHistoryStore,
  ConversationMessage,
} from "@/domain/conversation";
import { Hono, type Context } from "hono";

export type ConversationHistoryMessage = Omit<
  ConversationMessage,
  "id" | "conversationId"
> & {
  id?: number;
  conversationId?: string;
};

export interface ConversationHistoryClient {
  getHistory(conversationId: string): Promise<ConversationHistoryMessage[]>;
  appendMessage(
    conversationId: string,
    message: AppendConversationMessageInput,
  ): Promise<ConversationHistoryMessage>;
}

export interface CreateConversationHistoryRoutesOptions {
  history: ConversationHistoryStore;
  resolveUserId?: () => string | Promise<string>;
}

export function createConversationHistoryRoutes(
  options: CreateConversationHistoryRoutesOptions,
) {
  const app = new Hono();

  app.get("/api/conversations/:conversationId/history", async (context) => {
    const conversationId = normalizeIdentifier(
      context.req.param("conversationId"),
    );
    if (!conversationId) {
      return validationError(
        context,
        "conversationId must be a non-empty string.",
      );
    }

    const history = await options.history.getHistory(conversationId);
    return context.json(history);
  });

  app.post("/api/conversations/:conversationId/messages", async (context) => {
    const conversationId = normalizeIdentifier(
      context.req.param("conversationId"),
    );
    if (!conversationId) {
      return validationError(
        context,
        "conversationId must be a non-empty string.",
      );
    }

    const body = await readJsonBody(context.req.raw);
    if (!body.ok) {
      return validationError(context, body.message);
    }

    const message = validateAppendMessage(body.value);
    if (!message.ok) {
      return validationError(context, message.message);
    }

    const userId = await (options.resolveUserId?.() ?? "local-user");
    const stored = await options.history.appendMessage(
      conversationId,
      {
        ...message.value,
        parsedIntent: sanitizeMetadata(message.value.parsedIntent),
        actions: sanitizeMetadata(message.value.actions),
        result: sanitizeMetadata(message.value.result),
      },
      userId,
    );
    return context.json(stored, 201);
  });

  return app;
}

export const createConversationRoutes = createConversationHistoryRoutes;

export function createInMemoryConversationHistoryStore(): ConversationHistoryStore {
  const histories = new Map<string, ConversationMessage[]>();
  let nextId = 1;

  const appendMessage = (
    conversationId: string,
    message: AppendConversationMessageInput,
  ): ConversationMessage => {
    const history = histories.get(conversationId) ?? [];
    const duplicate = message.requestId
      ? history.find(
          (entry) =>
            entry.requestId === message.requestId &&
            entry.role === message.role,
        )
      : undefined;
    if (duplicate) {
      return duplicate;
    }

    const stored: ConversationMessage = {
      id: nextId,
      conversationId,
      role: message.role,
      content: message.content,
      requestId: message.requestId,
      parsedIntent: message.parsedIntent,
      actions: message.actions,
      result: message.result,
      createdAt: message.createdAt ?? new Date().toISOString(),
    };
    nextId += 1;
    history.push(stored);
    histories.set(conversationId, history);
    return stored;
  };

  return {
    getHistory(conversationId) {
      return [...(histories.get(conversationId) ?? [])];
    },
    appendMessage,
    appendTurn(conversationId, userMessage, assistantMessage) {
      return [
        appendMessage(conversationId, userMessage),
        appendMessage(conversationId, assistantMessage),
      ];
    },
  };
}

export function createConversationHistoryClient(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): ConversationHistoryClient {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return {
    async getHistory(
      conversationId: string,
    ): Promise<ConversationHistoryMessage[]> {
      const response = await fetchImpl(
        `${normalizedBaseUrl}/api/conversations/${encodeURIComponent(conversationId)}/history`,
      );

      if (!response.ok) {
        const errorBody = await safeReadErrorBody(response);
        throw new Error(
          `Conversation history request failed with ${response.status}: ${errorBody}`,
        );
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error("Conversation history API must return an array.");
      }

      return payload.filter(isConversationHistoryMessage);
    },
    async appendMessage(
      conversationId: string,
      message: AppendConversationMessageInput,
    ): Promise<ConversationHistoryMessage> {
      const response = await fetchImpl(
        `${normalizedBaseUrl}/api/conversations/${encodeURIComponent(conversationId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(message),
        },
      );
      if (!response.ok) {
        const errorBody = await safeReadErrorBody(response);
        throw new Error(
          `Conversation message request failed with ${response.status}: ${errorBody}`,
        );
      }
      const payload = await response.json();
      if (!isConversationHistoryMessage(payload)) {
        throw new Error(
          "Conversation message API returned an invalid message.",
        );
      }
      return payload;
    },
  };
}

export function sanitizeMetadata(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadata);
  }
  if (!isRecord(value)) {
    if (typeof value === "string" && /^Bearer\s+/i.test(value)) {
      return "[REDACTED]";
    }
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      continue;
    }
    sanitized[key] = sanitizeMetadata(nested);
  }
  return sanitized;
}

function validateAppendMessage(
  value: unknown,
):
  | { ok: true; value: AppendConversationMessageInput }
  | { ok: false; message: string } {
  if (!isRecord(value)) {
    return {
      ok: false,
      message: "Conversation message must be a JSON object.",
    };
  }
  if (value.role !== "user" && value.role !== "assistant") {
    return { ok: false, message: "role must be either user or assistant." };
  }
  if (!isNonEmptyString(value.content)) {
    return { ok: false, message: "content must be a non-empty string." };
  }
  if (value.requestId !== undefined && !isNonEmptyString(value.requestId)) {
    return {
      ok: false,
      message: "requestId must be a non-empty string when provided.",
    };
  }
  if (
    value.actions !== undefined &&
    value.actions !== null &&
    !Array.isArray(value.actions)
  ) {
    return { ok: false, message: "actions must be an array when provided." };
  }

  return {
    ok: true,
    value: {
      role: value.role,
      content: value.content.trim(),
      requestId:
        typeof value.requestId === "string"
          ? value.requestId.trim()
          : undefined,
      parsedIntent: value.parsedIntent,
      actions: value.actions,
      result: value.result,
    },
  };
}

function isConversationHistoryMessage(
  value: unknown,
): value is ConversationHistoryMessage {
  return (
    isRecord(value) &&
    (value.role === "user" || value.role === "assistant") &&
    isNonEmptyString(value.content)
  );
}

function normalizeIdentifier(value: string): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    normalized === "authorization" ||
    normalized === "authcontext" ||
    normalized === "cookie" ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("apikey")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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

function validationError(context: Context, message: string) {
  return context.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message,
      },
    },
    400,
  );
}

async function safeReadErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return "";
  }
}
