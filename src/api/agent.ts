/**
 * Agent message API for the meeting-room system.
 *
 * RFC-0002: Meeting Room Agent Orchestrator
 *
 * POST /api/agent/message accepts a user message, parses it through the Nex LLM
 * parser, orchestrates backend business APIs, and returns a natural-language reply
 * with machine-readable parsedIntent, actions, and error fields.
 */

import {
  createBusinessApiClient,
  formatAgentMessage,
  orchestrateAgentIntent,
  type AgentIntent,
  type AgentMessageResponse,
  type OrchestratorContext,
} from '@/agent/index.js';
import type { ConversationHistoryEntry } from '@/agent/nex.js';
import { createNexLLMClient } from '@/agent/nex.js';
import { Hono } from 'hono';

export interface AgentMessageRequest {
  userId: string;
  conversationId: string;
  message: string;
  history?: ConversationHistoryEntry[];
  authContext?: unknown;
}

export interface CreateAgentMessageRouteOptions {
  parser?: ReturnType<typeof createNexLLMClient>;
  businessApiClient?: ReturnType<typeof createBusinessApiClient>;
}

export function createAgentMessageRoute(options: CreateAgentMessageRouteOptions = {}) {
  const app = new Hono();

  app.post('/api/agent/message', async (context) => {
    const parser = options.parser ?? createNexLLMClient();
    const businessApiClient = options.businessApiClient ?? createBusinessApiClient();
    const body = await context.req.json() as AgentMessageRequest;
    const validationError = validateAgentMessageRequest(body);
    if (validationError) {
      return context.json(formatAgentMessage({ parserError: validationError }));
    }

    const parserResult = await parser.parseIntent({
      userId: body.userId,
      conversationId: body.conversationId,
      message: body.message,
      history: body.history ?? [],
      authContext: body.authContext,
    });

    if (parserResult.error) {
      return context.json(formatAgentMessage({
        parserError: parserResult.error,
      }));
    }

    const intent = parserResult.intent as AgentIntent | undefined;
    const orchestratorContext: OrchestratorContext = {
      userId: body.userId,
      authContext: body.authContext,
      client: businessApiClient,
    };
    const orchestratorResult = intent ? await orchestrateAgentIntent(intent, orchestratorContext) : undefined;

    return context.json(formatAgentMessage({
      intent,
      orchestratorResult,
    }));
  });

  return app;
}

function validateAgentMessageRequest(body: unknown): AgentMessageResponse['error'] {
  if (!isRecord(body)) {
    return {
      type: 'parse_failed',
      message: 'Agent message request must be a JSON object.',
    };
  }

  if (typeof body.userId !== 'string' || body.userId.trim() === '') {
    return {
      type: 'parse_failed',
      message: 'userId must be a non-empty string.',
    };
  }

  if (typeof body.conversationId !== 'string' || body.conversationId.trim() === '') {
    return {
      type: 'parse_failed',
      message: 'conversationId must be a non-empty string.',
    };
  }

  if (typeof body.message !== 'string' || body.message.trim() === '') {
    return {
      type: 'parse_failed',
      message: 'message must be a non-empty string.',
    };
  }

  return null;
}

export function validateAgentMessagePayload(payload: unknown): AgentMessageResponse['error'] {
  return validateAgentMessageRequest(payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
