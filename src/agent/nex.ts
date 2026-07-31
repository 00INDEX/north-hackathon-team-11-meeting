/**
 * OpenAI-compatible client for the northgate Nex LLM parser.
 *
 * RFC-0002: Nex LLM Client reads service-side environment variables only and is
 * not allowed to expose API keys in code, request payloads, or logs.
 */

import type { AgentIntent } from "./types.js";
import { parseAgentIntent } from "./schema.js";

export interface NexLLMClientConfig {
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
  now?: () => Date;
  timeZone?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  retryBaseDelayMs?: number;
}

export interface ConversationHistoryEntry {
  role: "user" | "assistant";
  content: string;
  parsedIntent?: unknown;
  actions?: unknown;
  result?: unknown;
}

export interface NexParserRequest {
  userId: string;
  conversationId: string;
  message: string;
  history: ConversationHistoryEntry[];
  authContext?: unknown;
}

export interface NexParserResult {
  intent?: AgentIntent;
  rawResponse?: string;
  attempts?: number;
  error?: {
    type: "parse_failed" | "backend_unavailable";
    message: string;
    details?: unknown;
  };
}

export interface NexChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
    details?: unknown;
  };
}

const DEFAULT_BASE_URL = "https://northgate.xiaobei.top/v1";
const DEFAULT_MODEL = "nex-agi/Nex-N2-Pro";
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 100;

export function createNexLLMClient(config?: Partial<NexLLMClientConfig>) {
  const resolvedConfig = resolveConfig(config);

  return {
    async parseIntent(request: NexParserRequest): Promise<NexParserResult> {
      const attempts = resolvedConfig.maxRetries + 1;
      let lastError: NexParserResult["error"];

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const rawResponse = await callNexChatCompletion(
            resolvedConfig,
            request,
          );
          const parsed = parseAgentIntent(rawResponse, {
            today: formatDateInTimeZone(
              resolvedConfig.now(),
              resolvedConfig.timeZone,
            ),
            timeZone: resolvedConfig.timeZone,
          });

          if (parsed.intent) {
            return {
              intent: parsed.intent,
              rawResponse,
              attempts: attempt,
            };
          }

          lastError = {
            type: "parse_failed",
            message:
              parsed.error?.message ??
              "LLM parser response did not match AgentIntent schema.",
            details: parsed.error?.details,
          };
        } catch (error) {
          lastError = {
            type: "backend_unavailable",
            message: "Nex LLM parser request failed.",
            details: error instanceof Error ? error.message : String(error),
          };
        }

        if (attempt < attempts) {
          await delay(resolvedConfig.retryBaseDelayMs * 2 ** (attempt - 1));
        }
      }

      return {
        attempts,
        error: lastError ?? {
          type: "parse_failed",
          message: "LLM parser response did not match AgentIntent schema.",
        },
      };
    },
  };
}

interface ResolvedNexLLMClientConfig extends Required<
  Pick<NexLLMClientConfig, "baseUrl" | "model">
> {
  apiKey: string;
  maxRetries: number;
  now: () => Date;
  timeZone: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  retryBaseDelayMs: number;
}

function resolveConfig(
  config: Partial<NexLLMClientConfig> | undefined,
): ResolvedNexLLMClientConfig {
  const baseUrl = trimTrailingSlash(
    config?.baseUrl ?? process.env.NEX_API_BASE_URL ?? DEFAULT_BASE_URL,
  );
  const apiKey = process.env.NEX_API_KEY;
  const model = config?.model ?? process.env.NEX_MODEL ?? DEFAULT_MODEL;
  const maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const now = config?.now ?? (() => new Date());
  const timeZone =
    config?.timeZone ?? process.env.MEETING_ROOM_TIME_ZONE ?? "Asia/Shanghai";
  const fetchImpl = config?.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = config?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryBaseDelayMs =
    config?.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;

  if (!apiKey || apiKey.trim() === "") {
    throw new Error("NEX_API_KEY is required for Nex LLM parser.");
  }

  return {
    apiKey,
    baseUrl,
    model,
    maxRetries,
    now,
    timeZone,
    fetchImpl,
    timeoutMs,
    retryBaseDelayMs,
  };
}

async function callNexChatCompletion(
  config: ResolvedNexLLMClientConfig,
  request: NexParserRequest,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  let response: Response;
  try {
    response = await config.fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0,
        messages: buildMessages(request, config),
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Nex LLM request timed out after ${config.timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorBody = await safeReadErrorBody(response);
    throw new Error(
      `Nex LLM request failed with ${response.status}: ${errorBody}`,
    );
  }

  const payload = await parseNexResponse(response);
  if (payload.error) {
    throw new Error(
      `Nex LLM returned API error: ${payload.error.message ?? payload.error.type ?? payload.error.code}`,
    );
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(
      "Nex LLM response did not include a string message content.",
    );
  }

  return content.trim();
}

function buildMessages(
  request: NexParserRequest,
  config: Pick<ResolvedNexLLMClientConfig, "now" | "timeZone">,
): Array<{ role: "system" | "user"; content: string }> {
  const historyText =
    request.history.length > 0
      ? request.history.map(formatHistoryEntry).join("\n")
      : "无历史消息。";
  const currentDate = formatDateInTimeZone(config.now(), config.timeZone);
  const currentWeekday = formatWeekdayInTimeZone(config.now(), config.timeZone);

  const authContextText =
    request.authContext === undefined
      ? "未提供额外认证上下文。"
      : JSON.stringify(request.authContext);

  return [
    {
      role: "system",
      content: `你是会议室预约系统 Agent 的 Nex LLM Parser。
RFC-0002: 你必须只返回严格 JSON，不要 Markdown、不要解释、不要代码块。
你的职责是把用户自然语言解析为 AgentIntent，最终权限、冲突和状态写入由后端负责。
服务端当前日期（${config.timeZone}）是 ${currentDate}，星期${currentWeekday}。
遇到“今天、明天、后天、本周、这周、下周”等相对日期时，date 必须保留用户原始相对日期短语，禁止自行换算为绝对日期；服务端会基于上述当前日期统一归一化。
自然语言时间段必须直接归一化：“上午”=09:00-12:00，“中午”=11:30-13:30，“下午”=13:00-18:00，“晚上”=18:00-22:00，“全天”=00:00-24:00。这些词已经提供了完整时间范围，不得因此追问具体钟点。
输出 schema:
- query_available_rooms: { type: "query_available_rooms", date: "YYYY-MM-DD 或原始相对日期短语", timeRange: { startTime: "HH:mm", endTime: "HH:mm" }, filters?: { roomType?: "small"|"medium"|"large"|"activity"|"combined", minCapacity?: number, equipment?: string[], combinedRoom?: boolean } }
- create_booking: { type: "create_booking", roomId: "非空字符串", date: "YYYY-MM-DD 或原始相对日期短语", timeRange: { startTime: "HH:mm", endTime: "HH:mm" }, title?: string, description?: string, attendees?: number }
- cancel_booking: { type: "cancel_booking", bookingId?: string, roomId?: string, date?: "YYYY-MM-DD 或原始相对日期短语", timeRange?: { startTime: "HH:mm", endTime: "HH:mm" }, title?: string, confirmationRequired?: boolean }
- create_unavailability_rule: { type: "create_unavailability_rule", target: "非空字符串", date?: "YYYY-MM-DD 或原始相对日期短语", timeRange?: { startTime: "HH:mm", endTime: "HH:mm" }, recurring?: { daysOfWeek: number[], timeRange: { startTime: "HH:mm", endTime: "HH:mm" } }, reason: "非空字符串" }
- update_last_unavailability_rule: { type: "update_last_unavailability_rule", target?: string, date?: "YYYY-MM-DD 或原始相对日期短语", timeRange?: { startTime: "HH:mm", endTime: "HH:mm" }, recurring?: { daysOfWeek: number[], timeRange: { startTime: "HH:mm", endTime: "HH:mm" } }, reason?: string }
- create_or_update_room: { type: "create_or_update_room", roomId: "非空字符串", name?: string, location?: string, capacity?: number, roomType?: "small"|"medium"|"large"|"activity", equipment?: string[] }
- create_combined_room: { type: "create_combined_room", combinedRoomId: "非空字符串", name?: string, componentRoomIds: string[], capacity?: number, equipment?: string[] }
- need_clarification: { type: "need_clarification", missingFields: string[], clarification: string }
时间格式必须使用 24 小时制 HH:mm；绝对日期使用 YYYY-MM-DD，相对日期保留原始短语。预约标题是可选字段，未提供标题时不得追问。
只有执行意图所需信息确实缺失时才返回 need_clarification：创建预约缺日期、时间或房间；创建规则缺目标、原因或日期/周期范围；组合房间缺少至少两个组件；房间更新没有任何修改字段。取消预约可通过 bookingId，或房间/日期/时间/标题筛选候选；“刚才那条预约”可由服务端历史解析，不得强制要求 bookingId。规则更新的 ruleId 也由服务端历史解析，只需用户给出至少一个修改字段。`,
    },
    {
      role: "user",
      content: `当前用户 ID: ${request.userId}
当前会话 ID: ${request.conversationId}
认证上下文: ${authContextText}
历史对话:
${historyText}

用户当前消息:
${request.message}

请只返回一个符合上述 schema 的 JSON 对象。`,
    },
  ];
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatWeekdayInTimeZone(date: Date, timeZone: string): string {
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    timeZone,
    weekday: "long",
  }).format(date);
  return weekday.replace(/^星期/, "");
}

function formatHistoryEntry(message: ConversationHistoryEntry): string {
  const metadata = [
    message.parsedIntent !== undefined
      ? `parsedIntent: ${JSON.stringify(message.parsedIntent)}`
      : undefined,
    message.actions !== undefined
      ? `actions: ${JSON.stringify(message.actions)}`
      : undefined,
    message.result !== undefined
      ? `result: ${JSON.stringify(message.result)}`
      : undefined,
  ].filter((line): line is string => line !== undefined);

  return metadata.length > 0
    ? `${message.role}: ${message.content}\n  ${metadata.join("\n  ")}`
    : `${message.role}: ${message.content}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

async function safeReadErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return "";
  }
}

async function parseNexResponse(
  response: Response,
): Promise<NexChatCompletionResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();
  if (
    !contentType.toLowerCase().includes("application/json") ||
    text.trim() === ""
  ) {
    throw new Error("Nex LLM response must be non-empty JSON.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Nex LLM response was not valid JSON.");
  }
  if (!isRecord(value)) {
    throw new Error("Nex LLM response must be a JSON object.");
  }
  return value as NexChatCompletionResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds > 0
    ? new Promise((resolve) => setTimeout(resolve, milliseconds))
    : Promise.resolve();
}
