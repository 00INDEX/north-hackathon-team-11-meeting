import assert from "node:assert/strict";
import test from "node:test";
import { createNexLLMClient } from "../../src/agent/nex.js";

const parserRequest = {
  userId: "u_001",
  conversationId: "c_001",
  message: "下周二 10:00 到 11:00 有哪些小会议室可用？",
  history: [],
};

test("createNexLLMClient parses a valid Nex JSON response", async () => {
  const intent = {
    type: "query_available_rooms",
    date: "2026-08-04",
    timeRange: {
      startTime: "10:00",
      endTime: "11:00",
    },
    filters: {
      roomType: "small",
    },
  };
  const originalFetch = globalThis.fetch;
  try {
    process.env.NEX_API_KEY = "test-key";
    const client = createNexLLMClient({
      baseUrl: "https://nex.example.test",
      model: "nex-test-model",
      maxRetries: 0,
      now: () => new Date("2026-07-31T00:00:00.000Z"),
      timeZone: "Asia/Shanghai",
    });
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        input.toString(),
        "https://nex.example.test/chat/completions",
      );
      assert.equal(
        (init?.headers as Record<string, string>)?.Authorization,
        "Bearer test-key",
      );

      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.equal(body.model, "nex-test-model");
      assert.equal(body.temperature, 0);
      assert.match(
        (body.messages as Array<Record<string, string>>)[0].content,
        /RFC-0002/,
      );
      assert.match(
        (body.messages as Array<Record<string, string>>)[0].content,
        /Asia\/Shanghai.*2026-07-31/,
      );
      assert.match(
        (body.messages as Array<Record<string, string>>)[0].content,
        /星期五/,
      );
      assert.match(
        (body.messages as Array<Record<string, string>>)[0].content,
        /相对日期.*保留用户原始相对日期短语/,
      );
      assert.match(
        (body.messages as Array<Record<string, string>>)[1].content,
        /用户当前消息:/,
      );

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(intent),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.error, undefined);
    assert.equal(result.intent?.type, "query_available_rooms");
    assert.equal(result.rawResponse, JSON.stringify(intent));
    assert.equal(result.attempts, 1);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("createNexLLMClient retries until the response matches schema", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const invalidResponse =
      calls === 1
        ? JSON.stringify({ type: "create_booking" })
        : JSON.stringify({
            type: "create_booking",
            roomId: "506",
            date: "2026-08-05",
            timeRange: {
              startTime: "10:00",
              endTime: "11:00",
            },
          });

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: invalidResponse,
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    process.env.NEX_API_KEY = "test-key";
    const client = createNexLLMClient({
      baseUrl: "https://nex.example.test",
      model: "nex-test-model",
      maxRetries: 1,
    });

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.error, undefined);
    assert.equal(result.intent?.type, "create_booking");
    assert.equal(result.attempts, 2);
    assert.equal(calls, 2);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("createNexLLMClient returns parse_failed after retries when schema is never satisfied", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: '{ type: "create_booking" }',
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );

  try {
    process.env.NEX_API_KEY = "test-key";
    const client = createNexLLMClient({
      baseUrl: "https://nex.example.test",
      model: "nex-test-model",
      maxRetries: 1,
    });

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.intent, undefined);
    assert.equal(result.attempts, 2);
    assert.equal(result.error?.type, "parse_failed");
    assert.match(result.error?.message ?? "", /not valid JSON/);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("createNexLLMClient returns backend_unavailable when Nex request fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("nex unavailable", {
      status: 503,
    });

  try {
    process.env.NEX_API_KEY = "test-key";
    const client = createNexLLMClient({
      baseUrl: "https://nex.example.test",
      model: "nex-test-model",
      maxRetries: 0,
    });

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.intent, undefined);
    assert.equal(result.error?.type, "backend_unavailable");
    assert.match(result.error?.message ?? "", /Nex LLM parser request failed/);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("createNexLLMClient reads API key from server-side environment when not configured", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(
      (init?.headers as Record<string, string>)?.Authorization,
      "Bearer env-key",
    );
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                type: "need_clarification",
                missingFields: ["date", "timeRange"],
                clarification: "请补充日期和时间。",
              }),
            },
          },
        ],
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      },
    );
  };

  try {
    process.env.NEX_API_KEY = "env-key";
    const client = createNexLLMClient({
      baseUrl: "https://nex.example.test",
      model: "nex-test-model",
      maxRetries: 0,
    });

    const result = await client.parseIntent(parserRequest);

    assert.equal(result.intent?.type, "need_clarification");
    assert.equal(result.error, undefined);
  } finally {
    delete process.env.NEX_API_KEY;
    globalThis.fetch = originalFetch;
  }
});

test("createNexLLMClient throws when API key is missing from config and environment", () => {
  assert.throws(
    () =>
      createNexLLMClient({
        baseUrl: "https://nex.example.test",
        model: "nex-test-model",
        maxRetries: 0,
      }),
    /NEX_API_KEY is required/,
  );
});

test("createNexLLMClient includes persisted result metadata in history prompt", async () => {
  process.env.NEX_API_KEY = "test-key";
  let userPrompt = "";
  try {
    const client = createNexLLMClient({
      baseUrl: "https://nex.example.test",
      maxRetries: 0,
      fetchImpl: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{ role: string; content: string }>;
        };
        userPrompt = body.messages[1].content;
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    type: "update_last_unavailability_rule",
                    ruleId: "rule-1",
                    timeRange: { startTime: "13:00", endTime: "18:00" },
                  }),
                },
              },
            ],
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    });
    await client.parseIntent({
      ...parserRequest,
      history: [
        {
          role: "assistant",
          content: "规则已创建",
          result: { ruleId: "rule-1" },
        },
      ],
    });
    assert.match(userPrompt, /result: \{"ruleId":"rule-1"\}/);
  } finally {
    delete process.env.NEX_API_KEY;
  }
});

test("createNexLLMClient times out and retries with finite backoff", async () => {
  process.env.NEX_API_KEY = "test-key";
  let calls = 0;
  try {
    const client = createNexLLMClient({
      baseUrl: "https://nex.example.test",
      maxRetries: 1,
      timeoutMs: 5,
      retryBaseDelayMs: 0,
      fetchImpl: async (_input, init) => {
        calls += 1;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => {
              reject(new DOMException("aborted", "AbortError"));
            },
            { once: true },
          );
        });
      },
    });
    const result = await client.parseIntent(parserRequest);
    assert.equal(result.error?.type, "backend_unavailable");
    assert.match(String(result.error?.details), /timed out/);
    assert.equal(calls, 2);
  } finally {
    delete process.env.NEX_API_KEY;
  }
});
