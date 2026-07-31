import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import { createAgentMessageRoute } from '../../src/api/agent.js';
import type { AgentIntent } from '../../src/agent/types.js';
import type { BackendBusinessApiClient } from '../../src/agent/businessApi.js';

test('POST /api/agent/message formats parser clarification as natural language reply', async () => {
  const app = new Hono();
  app.route('/', createAgentMessageRoute({
    parser: {
      async parseIntent() {
        return {
          intent: {
            type: 'need_clarification',
            missingFields: ['date', 'timeRange'],
            clarification: '请问你要预约哪个日期和时间段？',
          },
        };
      },
    },
    businessApiClient: createNoopBusinessApiClient(),
  }));

  const response = await app.request('/api/agent/message', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u_001',
      conversationId: 'c_001',
      message: '帮我预约一个小会议室',
      history: [],
    }),
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as Awaited<ReturnType<typeof response.json>>;
  assert.equal(payload.reply, '请问你要预约哪个日期和时间段？');
  assert.deepEqual(payload.parsedIntent, {
    type: 'need_clarification',
    missingFields: ['date', 'timeRange'],
    clarification: '请问你要预约哪个日期和时间段？',
  });
  assert.equal(payload.error, null);
});

test('POST /api/agent/message formats availability results with room list', async () => {
  const app = new Hono();
  app.route('/', createAgentMessageRoute({
    parser: {
      async parseIntent() {
        return {
          intent: {
            type: 'query_available_rooms',
            date: '2026-08-04',
            timeRange: { startTime: '10:00', endTime: '11:00' },
            filters: { roomType: 'small', minCapacity: 6 },
          } satisfies AgentIntent,
        };
      },
    },
    businessApiClient: createNoopBusinessApiClient(),
  }));

  const response = await app.request('/api/agent/message', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u_001',
      conversationId: 'c_001',
      message: '明天上午 10 点有什么小会议室？',
    }),
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as Awaited<ReturnType<typeof response.json>>;
  assert.equal(payload.reply, '2026-08-04 10:00—11:00，筛选条件：小会议室、至少 6 人可用会议室：506 6 人（A 座）；507 8 人（B 座）。');
  assert.equal(payload.error, null);
});

test('POST /api/agent/message formats parser errors without orchestrating backend calls', async () => {
  const app = new Hono();
  app.route('/', createAgentMessageRoute({
    parser: {
      async parseIntent() {
        return {
          error: {
            type: 'parse_failed',
            message: 'LLM parser response is not valid JSON.',
          },
        };
      },
    },
    businessApiClient: createFailingBusinessApiClient(),
  }));

  const response = await app.request('/api/agent/message', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u_001',
      conversationId: 'c_001',
      message: '帮我预约',
    }),
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as Awaited<ReturnType<typeof response.json>>;
  assert.equal(payload.reply, '抱歉，我暂时没有解析成功：LLM parser response is not valid JSON.。请换一种说法重试，或提供更明确的日期、时间、房间和标题。');
  assert.deepEqual(payload.error, {
    type: 'parse_failed',
    message: 'LLM parser response is not valid JSON.',
  });
  assert.deepEqual(payload.actions, []);
});

test('POST /api/agent/message formats request validation errors as parse failures', async () => {
  const app = new Hono();
  app.route('/', createAgentMessageRoute({
    parser: createFailingParser(),
    businessApiClient: createFailingBusinessApiClient(),
  }));

  const response = await app.request('/api/agent/message', {
    method: 'POST',
    body: JSON.stringify({
      conversationId: 'c_001',
      message: '帮我预约',
    }),
    headers: { 'content-type': 'application/json' },
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as Awaited<ReturnType<typeof response.json>>;
  assert.equal(payload.reply, '抱歉，我暂时没有解析成功：userId must be a non-empty string.。请换一种说法重试，或提供更明确的日期、时间、房间和标题。');
  assert.equal(payload.error.type, 'parse_failed');
  assert.deepEqual(payload.actions, []);
});

function createNoopBusinessApiClient(): BackendBusinessApiClient {
  return {
    async checkAvailability() {
      return {
        availableRooms: [
          { id: 'room-506', name: '506', capacity: 6, type: 'small', location: 'A 座' },
          { id: 'room-507', name: '507', capacity: 8, type: 'small', location: 'B 座' },
        ],
      };
    },
    async createBooking() {
      return {};
    },
    async cancelBooking() {
      return {};
    },
    async conflictCheck() {
      return { available: true };
    },
    async listRooms() {
      return [];
    },
    async createUnavailabilityRule() {
      return {};
    },
    async updateUnavailabilityRule() {
      return {};
    },
    async createOrUpdateRoom() {
      return {};
    },
    async createCombinedRoom() {
      return {};
    },
  };
}

function createFailingParser() {
  return {
    async parseIntent() {
      throw new Error('parser should not be called');
    },
  };
}

function createFailingBusinessApiClient(): BackendBusinessApiClient {
  return {
    async checkAvailability() {
      throw new Error('business API should not be called');
    },
    async createBooking() {
      throw new Error('business API should not be called');
    },
    async cancelBooking() {
      throw new Error('business API should not be called');
    },
    async conflictCheck() {
      throw new Error('business API should not be called');
    },
    async listRooms() {
      throw new Error('business API should not be called');
    },
    async createUnavailabilityRule() {
      throw new Error('business API should not be called');
    },
    async updateUnavailabilityRule() {
      throw new Error('business API should not be called');
    },
    async createOrUpdateRoom() {
      throw new Error('business API should not be called');
    },
    async createCombinedRoom() {
      throw new Error('business API should not be called');
    },
  };
}
