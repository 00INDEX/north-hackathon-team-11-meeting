/**
 * Conversation history API contract for the meeting-room Agent.
 *
 * RFC-0002: Meeting Room Agent Orchestrator
 *
 * The Agent endpoint consumes a conversationId and complete history. This module
 * adapts the backend GET /api/conversations/:conversationId/history contract
 * without owning long-term storage, retention, or deletion policy.
 */

export interface ConversationHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  parsedIntent?: unknown;
  actions?: unknown;
}

export interface ConversationHistoryClient {
  getHistory(conversationId: string): Promise<ConversationHistoryMessage[]>;
}

/**
 * Create a fetch-backed conversation history client for the RFC backend contract.
 */
export function createConversationHistoryClient(baseUrl: string, fetchImpl: typeof fetch = fetch): ConversationHistoryClient {
  const normalizedBaseUrl = trimTrailingSlash(baseUrl);

  return {
    async getHistory(conversationId: string): Promise<ConversationHistoryMessage[]> {
      const response = await fetchImpl(`${normalizedBaseUrl}/api/conversations/${encodeURIComponent(conversationId)}/history`);

      if (!response.ok) {
        const errorBody = await safeReadErrorBody(response);
        throw new Error(`Conversation history request failed with ${response.status}: ${errorBody}`);
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        throw new Error('Conversation history API must return an array.');
      }

      return payload.filter(isConversationHistoryMessage);
    },
  };
}

function isConversationHistoryMessage(value: unknown): value is ConversationHistoryMessage {
  if (!isRecord(value)) {
    return false;
  }

  if (value.role !== 'user' && value.role !== 'assistant') {
    return false;
  }

  return isNonEmptyString(value.content);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
