import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";
import {
  createConversationHistoryClient,
  createConversationHistoryRoutes,
} from "../../src/api/history.js";
import {
  closeDatabase,
  openDatabase,
  runMigrations,
} from "../../src/db/index.js";
import { ConversationHistoryRepository } from "../../src/persistence/sqlite/ConversationHistoryRepository.js";

test("SQLite conversation history appends an ordered, idempotent turn with metadata", () => {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "conversation-history-"),
  );
  const db = openDatabase({
    filePath: path.join(directory, "history.sqlite3"),
  });
  try {
    runMigrations(db);
    const history = new ConversationHistoryRepository(db, "demo-user");
    const turn = history.appendTurn(
      "conversation-1",
      {
        role: "user",
        content: "把 506 设为不可预约",
        requestId: "request-1",
      },
      {
        role: "assistant",
        content: "规则已创建",
        requestId: "request-1",
        parsedIntent: { type: "create_unavailability_rule" },
        actions: [
          {
            type: "create_unavailability_rule",
            result: { rule: { id: "rule-1" } },
          },
        ],
        result: { ruleId: "rule-1" },
      },
    );

    assert.deepEqual(
      turn.map((message) => message.role),
      ["user", "assistant"],
    );
    assert.equal(
      turn[1].result && (turn[1].result as { ruleId: string }).ruleId,
      "rule-1",
    );

    history.appendTurn(
      "conversation-1",
      { role: "user", content: "重复请求", requestId: "request-1" },
      { role: "assistant", content: "重复响应", requestId: "request-1" },
    );

    const stored = history.getHistory("conversation-1");
    assert.equal(stored.length, 2);
    assert.deepEqual(
      stored.map((message) => message.id),
      [turn[0].id, turn[1].id],
    );
    assert.equal(
      stored[1].parsedIntent &&
        (stored[1].parsedIntent as { type: string }).type,
      "create_unavailability_rule",
    );
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("conversation history routes append, sanitize and read messages", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "conversation-routes-"));
  const db = openDatabase({
    filePath: path.join(directory, "history.sqlite3"),
  });
  try {
    runMigrations(db);
    const app = new Hono();
    app.route(
      "/",
      createConversationHistoryRoutes({
        history: new ConversationHistoryRepository(db),
        resolveUserId: () => "server-user",
      }),
    );

    const appendResponse = await app.request(
      "/api/conversations/conv%201/messages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          role: "assistant",
          content: "规则已创建",
          parsedIntent: { type: "create_unavailability_rule" },
          actions: [
            {
              type: "create_unavailability_rule",
              authorization: "Bearer must-not-leak",
              result: { rule: { id: "rule-1" }, token: "must-not-leak" },
            },
          ],
          result: { ruleId: "rule-1", authContext: { role: "admin" } },
        }),
      },
    );
    assert.equal(appendResponse.status, 201);
    assert.doesNotMatch(
      await appendResponse.clone().text(),
      /must-not-leak|authContext/,
    );

    const readResponse = await app.request(
      "/api/conversations/conv%201/history",
    );
    assert.equal(readResponse.status, 200);
    const messages = (await readResponse.json()) as Array<
      Record<string, unknown>
    >;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].content, "规则已创建");
    assert.deepEqual(messages[0].result, { ruleId: "rule-1" });
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("conversation history routes reject malformed JSON with 400", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "conversation-json-"));
  const db = openDatabase({
    filePath: path.join(directory, "history.sqlite3"),
  });
  try {
    runMigrations(db);
    const app = createConversationHistoryRoutes({
      history: new ConversationHistoryRepository(db),
    });
    const response = await app.request(
      "/api/conversations/conversation-1/messages",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"role":',
      },
    );
    assert.equal(response.status, 400);
    assert.match(await response.text(), /valid JSON/);
  } finally {
    closeDatabase(db);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("createConversationHistoryClient fetches and appends the history contract", async () => {
  const historyPayload = [
    {
      role: "user",
      content: "帮我查一下明天下午有没有会议室",
      parsedIntent: { type: "query_available_rooms" },
    },
    {
      role: "assistant",
      content: "已帮你查询明天下午的可用会议室。",
      actions: [{ type: "query_available_rooms", status: "completed" }],
    },
    { role: "user", content: "" },
    { role: "system", content: "系统消息会被过滤" },
  ];
  const requests: Array<{ url: string; method: string }> = [];
  const client = createConversationHistoryClient(
    "https://example.test",
    async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      requests.push({ url, method });
      if (method === "POST") {
        return new Response(
          JSON.stringify({
            id: 3,
            conversationId: "conv 1",
            role: "assistant",
            content: "完成",
            createdAt: "2026-07-31T00:00:00.000Z",
          }),
          {
            status: 201,
            headers: { "content-type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify(historyPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  );

  const history = await client.getHistory("conv 1");
  const appended = await client.appendMessage("conv 1", {
    role: "assistant",
    content: "完成",
  });

  assert.deepEqual(history, [historyPayload[0], historyPayload[1]]);
  assert.equal(appended.content, "完成");
  assert.deepEqual(requests, [
    {
      url: "https://example.test/api/conversations/conv%201/history",
      method: "GET",
    },
    {
      url: "https://example.test/api/conversations/conv%201/messages",
      method: "POST",
    },
  ]);
});

test("createConversationHistoryClient rejects invalid responses and backend errors", async () => {
  const invalidClient = createConversationHistoryClient(
    "https://example.test",
    async () => new Response(JSON.stringify({})),
  );
  await assert.rejects(
    invalidClient.getHistory("conv 1"),
    /must return an array/,
  );

  const failingClient = createConversationHistoryClient(
    "https://example.test",
    async () => new Response("not found", { status: 404 }),
  );
  await assert.rejects(failingClient.getHistory("conv 1"), /failed with 404/);
});
