export type ConversationMessageRole = "user" | "assistant";

export interface ConversationMessage {
  id: number;
  conversationId: string;
  role: ConversationMessageRole;
  content: string;
  requestId?: string;
  parsedIntent?: unknown;
  actions?: unknown;
  result?: unknown;
  createdAt: string;
}

export interface AppendConversationMessageInput {
  role: ConversationMessageRole;
  content: string;
  requestId?: string;
  parsedIntent?: unknown;
  actions?: unknown;
  result?: unknown;
  createdAt?: string;
}

export interface ConversationHistoryStore {
  getHistory(
    conversationId: string,
  ): Promise<ConversationMessage[]> | ConversationMessage[];
  appendMessage(
    conversationId: string,
    message: AppendConversationMessageInput,
    userId?: string,
  ): Promise<ConversationMessage> | ConversationMessage;
  appendTurn(
    conversationId: string,
    userMessage: AppendConversationMessageInput,
    assistantMessage: AppendConversationMessageInput,
    userId?: string,
  ):
    | Promise<[ConversationMessage, ConversationMessage]>
    | [ConversationMessage, ConversationMessage];
}
