import type { Database } from "@/db";
import type {
  AppendConversationMessageInput,
  ConversationHistoryStore,
  ConversationMessage,
  ConversationMessageRole,
} from "@/domain/conversation";

interface ConversationMessageRow {
  id: number;
  conversation_id: string;
  role: ConversationMessageRole;
  content: string;
  request_id: string | null;
  parsed_intent: string | null;
  actions: string | null;
  result: string | null;
  created_at: string;
}

export class ConversationHistoryRepository implements ConversationHistoryStore {
  constructor(
    private readonly db: Database,
    private readonly defaultUserId = "local-user",
  ) {}

  getHistory(conversationId: string): ConversationMessage[] {
    return (
      this.db
        .prepare(
          `SELECT id, conversation_id, role, content, request_id,
                  parsed_intent, actions, result, created_at
             FROM conversation_messages
            WHERE conversation_id = ?
            ORDER BY id`,
        )
        .all(conversationId) as ConversationMessageRow[]
    ).map(mapConversationMessage);
  }

  appendMessage(
    conversationId: string,
    message: AppendConversationMessageInput,
    userId = this.defaultUserId,
  ): ConversationMessage {
    return this.db.transaction(() => {
      this.touchConversation(conversationId, userId, message.createdAt);
      return this.insertMessage(conversationId, message);
    })();
  }

  appendTurn(
    conversationId: string,
    userMessage: AppendConversationMessageInput,
    assistantMessage: AppendConversationMessageInput,
    userId = this.defaultUserId,
  ): [ConversationMessage, ConversationMessage] {
    return this.db.transaction(() => {
      const createdAt = assistantMessage.createdAt ?? userMessage.createdAt;
      this.touchConversation(conversationId, userId, createdAt);
      const storedUserMessage = this.insertMessage(conversationId, userMessage);
      const storedAssistantMessage = this.insertMessage(
        conversationId,
        assistantMessage,
      );
      return [storedUserMessage, storedAssistantMessage] as [
        ConversationMessage,
        ConversationMessage,
      ];
    })();
  }

  private touchConversation(
    conversationId: string,
    userId: string,
    createdAt?: string,
  ): void {
    const now = createdAt ?? new Date().toISOString();
    const existing = this.db
      .prepare("SELECT user_id AS userId FROM conversations WHERE id = ?")
      .get(conversationId) as { userId: string } | undefined;

    if (existing && existing.userId !== userId) {
      throw new Error("Conversation belongs to another user.");
    }

    this.db
      .prepare(
        `INSERT INTO conversations (id, user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(conversationId, userId, now, now);
  }

  private insertMessage(
    conversationId: string,
    message: AppendConversationMessageInput,
  ): ConversationMessage {
    const createdAt = message.createdAt ?? new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO conversation_messages (
           conversation_id, role, content, request_id, parsed_intent, actions, result, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id, request_id, role) WHERE request_id IS NOT NULL
         DO NOTHING`,
      )
      .run(
        conversationId,
        message.role,
        message.content,
        message.requestId ?? null,
        serializeMetadata(message.parsedIntent),
        serializeMetadata(message.actions),
        serializeMetadata(message.result),
        createdAt,
      );

    const row =
      result.changes === 1
        ? this.db
            .prepare(
              `SELECT id, conversation_id, role, content, request_id,
                    parsed_intent, actions, result, created_at
               FROM conversation_messages
              WHERE id = last_insert_rowid()`,
            )
            .get()
        : this.db
            .prepare(
              `SELECT id, conversation_id, role, content, request_id,
                    parsed_intent, actions, result, created_at
               FROM conversation_messages
              WHERE conversation_id = ? AND request_id = ? AND role = ?`,
            )
            .get(conversationId, message.requestId, message.role);

    if (!row) {
      throw new Error("Conversation message could not be persisted.");
    }
    return mapConversationMessage(row as ConversationMessageRow);
  }
}

function mapConversationMessage(
  row: ConversationMessageRow,
): ConversationMessage {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    requestId: row.request_id ?? undefined,
    parsedIntent: parseMetadata(row.parsed_intent),
    actions: parseMetadata(row.actions),
    result: parseMetadata(row.result),
    createdAt: row.created_at,
  };
}

function serializeMetadata(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function parseMetadata(value: string | null): unknown {
  if (value === null) {
    return undefined;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}
