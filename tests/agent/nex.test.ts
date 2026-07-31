import assert from 'node:assert/strict';
import test from 'node:test';
import { createNexLLMClient } from '../../src/agent/nex.js';

const parserRequest = {
  userId: 'u_001',
  conversationId: 'c_001',
  message: '下周二 10:00 到 11:00 有哪些小会议室可用？',
  history: [],
};

test('createNexLLMClient parses a valid Nex JSON response', async () => {
  const intent = {
    type: 'query_available_rooms',
    date: '2026-08-04',
    timeRange: {
      startTime: '10:00',
      endTime: '11:00',
    },
    filters: {
      roomType: 'small',
    },
  };
  const originalFetch = globalThis.fetch;
  try {
    process.env.NEX_API_KEY = 'test-key';
    const client = createNexLLMClient({
      baseUrl: 'https://nex.example.test',
      model: 'nex-test-model',
      maxRetries: 0,
    });
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(input.toString(), 'https://nex.example.test/chat/completions');
      assert.equal((init?.headers as Record<string, string>)?.Authorization, 'Bearer test-key');

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.model, 'nex-test-model');
      assert.equal(body.temperature, 0);
      assert.match((body.messages as Array<Record<string, string>>)[0].content, /RFC-0002/);
      assert.match((body.messages as Array<Record<string, string>>)[1].content, /用户当前消息:/);

      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify(intent),
          },
        }],
      }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    };

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.error, undefined);
    assert.equal(result.intent?.type, 'query_available_rooms');
    assert.equal(result.rawResponse, JSON.stringify(intent));
    assert.equal(result.attempts, 1);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test('createNexLLMClient retries until the response matches schema', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const invalidResponse = calls === 1
      ? JSON.stringify({ type: 'create_booking' })
      : JSON.stringify({
        type: 'create_booking',
        userId: 'u_001',
        roomId: '506',
        date: '2026-08-05',
        timeRange: {
          startTime: '10:00',
          endTime: '11:00',
        },
      });

    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: invalidResponse,
        },
      }],
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  };

  try {
    process.env.NEX_API_KEY = 'test-key';
    const client = createNexLLMClient({
      baseUrl: 'https://nex.example.test',
      model: 'nex-test-model',
      maxRetries: 1,
    });

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.error, undefined);
    assert.equal(result.intent?.type, 'create_booking');
    assert.equal(result.attempts, 2);
    assert.equal(calls, 2);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test('createNexLLMClient returns parse_failed after retries when schema is never satisfied', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: '{ type: "create_booking" }',
      },
    }],
  }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  try {
    process.env.NEX_API_KEY = 'test-key';
    const client = createNexLLMClient({
      baseUrl: 'https://nex.example.test',
      model: 'nex-test-model',
      maxRetries: 1,
    });

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.intent, undefined);
    assert.equal(result.attempts, 2);
    assert.equal(result.error?.type, 'parse_failed');
    assert.match(result.error?.message ?? '', /not valid JSON/);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test('createNexLLMClient returns backend_unavailable when Nex request fails', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nex unavailable', {
    status: 503,
  });

  try {
    process.env.NEX_API_KEY = 'test-key';
    const client = createNexLLMClient({
      baseUrl: 'https://nex.example.test',
      model: 'nex-test-model',
      maxRetries: 0,
    });

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.intent, undefined);
    assert.equal(result.error?.type, 'backend_unavailable');
    assert.match(result.error?.message ?? '', /Nex LLM parser request failed/);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test('createNexLLMClient reads API key from server-side environment when not configured', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal((init?.headers as Record<string, string>)?.Authorization, 'Bearer env-key');
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            type: 'need_clarification',
            missingFields: ['date', 'timeRange'],
            clarification: '请补充日期和时间。',
          }),
        },
      }],
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  };

  try {
    process.env.NEX_API_KEY = 'env-key';
    const client = createNexLLMClient({
      baseUrl: 'https://nex.example.test',
      model: 'nex-test-model',
      maxRetries: 0,
    });

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.intent?.type, 'need_clarification');
    assert.equal(result.error, undefined);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test('createNexLLMClient throws when API key is missing from config and environment', () => {
  assert.throws(
    () => createNexLLMClient({
      baseUrl: 'https://nex.example.test',
      model: 'nex-test-model',
      maxRetries: 0,
    }),
    /NEX_API_KEY is required/,
  );
});
