/**
 * OpenAI-compatible client for the northgate Nex LLM parser.
 *
 * RFC-0002: Nex LLM Client reads service-side environment variables only and is
 * not allowed to expose API keys in code, request payloads, or logs.
 */

import type { AgentIntent } from './types.js';
import { parseAgentIntent } from './schema.js';

export interface NexLLMClientConfig {
  baseUrl?: string;
  model?: string;
  maxRetries?: number;
}

export interface ConversationHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
  parsedIntent?: unknown;
  actions?: unknown;
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
    type: 'parse_failed' | 'backend_unavailable';
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

const DEFAULT_BASE_URL = 'https://northgate.xiaobei.top/v1';
const DEFAULT_MODEL = 'nex-agi/Nex-N2-Pro';
const DEFAULT_MAX_RETRIES = 2;

export function createNexLLMClient(config?: Partial<NexLLMClientConfig>) {
  const resolvedConfig = resolveConfig(config);

  return {
    async parseIntent(request: NexParserRequest): Promise<NexParserResult> {
      const attempts = resolvedConfig.maxRetries + 1;
      let lastError: NexParserResult['error'];

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          const rawResponse = await callNexChatCompletion(resolvedConfig, request);
          const parsed = parseAgentIntent(rawResponse);

          if (parsed.intent) {
            return {
              intent: parsed.intent,
              rawResponse,
              attempts: attempt,
            };
          }

          lastError = {
            type: 'parse_failed',
            message: parsed.error?.message ?? 'LLM parser response did not match AgentIntent schema.',
            details: parsed.error?.details,
          };
        } catch (error) {
          lastError = {
            type: 'backend_unavailable',
            message: 'Nex LLM parser request failed.',
            details: error instanceof Error ? error.message : String(error),
          };
        }
      }

      return {
        attempts,
        error: lastError ?? {
          type: 'parse_failed',
          message: 'LLM parser response did not match AgentIntent schema.',
        },
      };
    },
  };
}

interface ResolvedNexLLMClientConfig extends Required<Pick<NexLLMClientConfig, 'baseUrl' | 'model'>> {
  apiKey: string;
  maxRetries: number;
}

function resolveConfig(config: Partial<NexLLMClientConfig> | undefined): ResolvedNexLLMClientConfig {
  const baseUrl = trimTrailingSlash(config?.baseUrl ?? process.env.NEX_API_BASE_URL ?? DEFAULT_BASE_URL);
  const apiKey = process.env.NEX_API_KEY;
  const model = config?.model ?? process.env.NEX_MODEL ?? DEFAULT_MODEL;
  const maxRetries = config?.maxRetries ?? DEFAULT_MAX_RETRIES;

  if (!apiKey || apiKey.trim() === '') {
    throw new Error('NEX_API_KEY is required for Nex LLM parser.');
  }

  return {
    apiKey,
    baseUrl,
    model,
    maxRetries,
  };
}

async function callNexChatCompletion(config: ResolvedNexLLMClientConfig, request: NexParserRequest): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0,
      messages: buildMessages(request),
    }),
  });

  if (!response.ok) {
    const errorBody = await safeReadErrorBody(response);
    throw new Error(`Nex LLM request failed with ${response.status}: ${errorBody}`);
  }

  const payload = (await response.json()) as NexChatCompletionResponse;
  if (payload.error) {
    throw new Error(`Nex LLM returned API error: ${payload.error.message ?? payload.error.type ?? payload.error.code}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('Nex LLM response did not include a string message content.');
  }

  return content.trim();
}

function buildMessages(request: NexParserRequest): Array<{ role: 'system' | 'user'; content: string }> {
  const historyText = request.history.length > 0
    ? request.history.map(formatHistoryEntry).join('\n')
    : '无历史消息。';

  const authContextText = request.authContext === undefined
    ? '未提供额外认证上下文。'
    : JSON.stringify(request.authContext);

  return [
    {
      role: 'system',
      content: `你是会议室预约系统 Agent 的 Nex LLM Parser。
RFC-0002: 你必须只返回严格 JSON，不要 Markdown、不要解释、不要代码块。
你的职责是把用户自然语言解析为 AgentIntent，最终权限、冲突和状态写入由后端负责。
输出 schema:
- query_available_rooms: { type: "query_available_rooms", date: "YYYY-MM-DD", timeRange: { startTime: "HH:mm", endTime: "HH:mm" }, filters?: { roomType?: "small"|"medium"|"large"|"activity"|"combined", minCapacity?: number, equipment?: string[], combinedRoom?: boolean } }
- create_booking: { type: "create_booking", userId: "非空字符串", roomId: "非空字符串", date: "YYYY-MM-DD", timeRange: { startTime: "HH:mm", endTime: "HH:mm" }, title?: string, description?: string, attendees?: number }
- cancel_booking: { type: "cancel_booking", bookingId?: string, roomId?: string, date?: "YYYY-MM-DD", timeRange?: { startTime: "HH:mm", endTime: "HH:mm" }, title?: string, confirmationRequired?: boolean }
- create_unavailability_rule: { type: "create_unavailability_rule", target: "非空字符串", date?: "YYYY-MM-DD", timeRange?: { startTime: "HH:mm", endTime: "HH:mm" }, recurring?: { daysOfWeek: number[], timeRange: { startTime: "HH:mm", endTime: "HH:mm" } }, reason: "非空字符串" }
- update_last_unavailability_rule: { type: "update_last_unavailability_rule", target?: string, date?: "YYYY-MM-DD", timeRange?: { startTime: "HH:mm", endTime: "HH:mm" }, recurring?: { daysOfWeek: number[], timeRange: { startTime: "HH:mm", endTime: "HH:mm" } }, reason?: string }
- create_or_update_room: { type: "create_or_update_room", roomId: "非空字符串", name?: string, location?: string, capacity?: number, roomType?: "small"|"medium"|"large"|"activity", equipment?: string[] }
- create_combined_room: { type: "create_combined_room", combinedRoomId: "非空字符串", name?: string, componentRoomIds: string[], capacity?: number, equipment?: string[] }
- need_clarification: { type: "need_clarification", missingFields: string[], clarification: string }
时间格式必须使用 24 小时制 HH:mm，日期必须使用 YYYY-MM-DD。全天使用 00:00-24:00。
如果缺少日期、时间、房间、目标、预约 ID、组件房间或规则修改字段，返回 need_clarification，并包含缺失字段和中文追问。`,
    },
    {
      role: 'user',
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

function formatHistoryEntry(message: ConversationHistoryEntry): string {
  const metadata = [
    message.parsedIntent !== undefined ? `parsedIntent: ${JSON.stringify(message.parsedIntent)}` : undefined,
    message.actions !== undefined ? `actions: ${JSON.stringify(message.actions)}` : undefined,
  ].filter((line): line is string => line !== undefined);

  return metadata.length > 0
    ? `${message.role}: ${message.content}\n  ${metadata.join('\n  ')}`
    : `${message.role}: ${message.content}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

async function safeReadErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text();
    return text.length > 500 ? `${text.slice(0, 500)}...` : text;
  } catch {
    return '';
  }
}
