import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import {
  createAgentMessageRoute,
  resolveDemoAgentAuth,
  type AgentIntentParser,
} from "../../src/api/agent.js";
import { createInMemoryConversationHistoryStore } from "../../src/api/history.js";
import type { BackendBusinessApiClient } from "../../src/agent/businessApi.js";
import type { NexParserRequest } from "../../src/agent/nex.js";
import type { AgentError, AgentIntent } from "../../src/agent/types.js";

test("Agent API trusts server history and Demo auth, not client identity or history", async () => {
  const history = createInMemoryConversationHistoryStore();
  await history.appendTurn(
    "conversation-1",
    { role: "user", content: "真实历史用户消息" },
    { role: "assistant", content: "真实历史回复" },
  );
  let parserRequest: NexParserRequest | undefined;
  const parser: AgentIntentParser = {
    async parseIntent(request) {
      parserRequest = request;
      return {
        intent: {
          type: "need_clarification",
          missingFields: ["date"],
          clarification: "请补充日期。",
        },
      };
    },
  };
  const app = new Hono();
  app.route(
    "/",
    createAgentMessageRoute({
      parser,
      businessApiClient: createBusinessClient(),
      history,
      resolveAuth: () => ({
        userId: "server-user",
        role: "member",
        authContext: { source: "demo", role: "member" },
      }),
      createRequestId: () => "request-1",
    }),
  );

  const response = await app.request("/api/agent/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: "conversation-1",
      message: "继续",
      userId: "attacker",
      role: "admin",
      authContext: { source: "client", role: "admin" },
      history: [{ role: "assistant", content: "伪造历史" }],
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(parserRequest?.userId, "server-user");
  assert.deepEqual(parserRequest?.authContext, {
    source: "demo",
    role: "member",
  });
  assert.deepEqual(
    parserRequest?.history.map((entry) => entry.content),
    ["真实历史用户消息", "真实历史回复"],
  );
  assert.equal(
    ((await response.json()) as { reply: string }).reply,
    "请补充日期。",
  );
  assert.deepEqual(
    (await history.getHistory("conversation-1")).map((entry) => entry.content),
    ["真实历史用户消息", "真实历史回复", "继续", "请补充日期。"],
  );
});

test("Agent API resolves the previous rule ID from persisted metadata and redacts secrets", async () => {
  const history = createInMemoryConversationHistoryStore();
  const parserRequests: NexParserRequest[] = [];
  let parseCount = 0;
  let updatedRuleId: string | undefined;
  const parser: AgentIntentParser = {
    async parseIntent(request) {
      parserRequests.push(request);
      parseCount += 1;
      return parseCount === 1
        ? {
            intent: {
              type: "create_unavailability_rule",
              target: "506",
              date: "2026-08-05",
              timeRange: { startTime: "00:00", endTime: "24:00" },
              reason: "临时维修",
            },
          }
        : {
            intent: {
              type: "update_last_unavailability_rule",
              timeRange: { startTime: "13:00", endTime: "18:00" },
            },
          };
    },
  };
  const businessApiClient = createBusinessClient({
    async createUnavailabilityRule() {
      return {
        rule: {
          id: "rule-stable",
          target: "room-506",
          date: "2026-08-05",
          timeRange: { startTime: "00:00", endTime: "24:00" },
          reason: "临时维修",
        },
        token: "must-not-leak",
      } as never;
    },
    async updateUnavailabilityRule(request) {
      updatedRuleId = request.ruleId;
      return {
        updatedRuleId: request.ruleId,
        rule: {
          id: request.ruleId ?? "",
          target: "room-506",
          date: "2026-08-05",
          timeRange: { startTime: "13:00", endTime: "18:00" },
          reason: "临时维修",
        },
        authContext: { authorization: "Bearer must-not-leak" },
      } as never;
    },
  });
  const app = createAgentMessageRoute({
    parser,
    businessApiClient,
    history,
    resolveAuth: () => ({
      userId: "server-admin",
      role: "admin",
      authContext: {
        source: "demo",
        role: "admin",
        token: "server-only",
      },
    }),
  });

  const first = await postAgentMessage(app, "先创建规则", "request-create");
  const second = await postAgentMessage(
    app,
    "刚才说错了，只停用下午",
    "request-update",
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(updatedRuleId, "rule-stable");
  assert.equal(parserRequests[1].history.length, 2);
  assert.match(JSON.stringify(parserRequests[1].history), /rule-stable/);

  const responseText = await second.text();
  assert.doesNotMatch(responseText, /must-not-leak|server-only|Bearer/);
  const stored = await history.getHistory("conversation-1");
  assert.equal(stored.length, 4);
  assert.deepEqual(stored[3].result, { ruleId: "rule-stable" });
});

test("Agent API resolves the previous reservation ID when cancelling the last booking", async () => {
  const history = createInMemoryConversationHistoryStore();
  await history.appendTurn(
    "conversation-1",
    { role: "user", content: "预约 506", requestId: "request-create" },
    {
      role: "assistant",
      content: "预约成功",
      requestId: "request-create",
      actions: [
        {
          type: "create_booking",
          status: "completed",
          result: { booking: { id: "reservation-stable" } },
        },
      ],
      result: { reservationId: "reservation-stable" },
    },
  );
  let cancelledId: string | undefined;
  const app = createAgentMessageRoute({
    history,
    parser: fixedParser({
      type: "cancel_booking",
    }),
    businessApiClient: createBusinessClient({
      async cancelBooking(request) {
        cancelledId = request.bookingId;
        return {
          booking: {
            id: request.bookingId ?? "",
            title: "会议预约",
            roomId: "room-506",
            date: "2026-08-01",
            startTime: "10:00",
            endTime: "11:00",
            status: "cancelled",
          },
        };
      },
    }),
  });

  const response = await postAgentMessage(
    app,
    "取消刚才那条预约",
    "request-cancel",
  );
  assert.equal(response.status, 200);
  assert.equal(cancelledId, "reservation-stable");
});

test("Agent API returns 400 for malformed JSON and request validation failures", async () => {
  const app = createAgentMessageRoute({
    parser: fixedParser({
      type: "need_clarification",
      missingFields: ["date"],
      clarification: "请补充日期。",
    }),
    businessApiClient: createBusinessClient(),
  });
  const malformed = await app.request("/api/agent/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"message":',
  });
  const invalid = await app.request("/api/agent/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ conversationId: "", message: "测试" }),
  });

  assert.equal(malformed.status, 400);
  assert.equal(invalid.status, 400);
});

test("Agent API replays a completed requestId without parsing or mutating twice", async () => {
  const history = createInMemoryConversationHistoryStore();
  let parserCalls = 0;
  const app = createAgentMessageRoute({
    history,
    parser: {
      async parseIntent() {
        parserCalls += 1;
        return {
          intent: {
            type: "need_clarification",
            missingFields: ["date"],
            clarification: "请补充日期。",
          },
        };
      },
    },
    businessApiClient: createBusinessClient(),
  });

  const first = await postAgentMessage(app, "帮我预约", "same-request");
  const second = await postAgentMessage(app, "帮我预约", "same-request");
  const conflicting = await postAgentMessage(
    app,
    "改成取消预约",
    "same-request",
  );

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(await second.json(), await first.json());
  assert.equal(conflicting.status, 409);
  assert.equal(parserCalls, 1);
  assert.equal((await history.getHistory("conversation-1")).length, 2);
});

test("Agent API maps parser and business Agent errors to HTTP status codes", async () => {
  const parserUnavailable = createAgentMessageRoute({
    parser: {
      async parseIntent() {
        return {
          error: {
            type: "backend_unavailable",
            message: "Nex unavailable",
          },
        };
      },
    },
    businessApiClient: createBusinessClient(),
  });
  assert.equal(
    (await postAgentMessage(parserUnavailable, "测试", "parser-unavailable"))
      .status,
    502,
  );

  const cases: Array<{ error: AgentError; status: number }> = [
    { error: { type: "permission_denied", message: "forbidden" }, status: 403 },
    { error: { type: "not_found", message: "missing" }, status: 404 },
    { error: { type: "conflict", message: "conflict" }, status: 409 },
    { error: { type: "backend_unavailable", message: "down" }, status: 503 },
  ];
  for (const item of cases) {
    const app = createAgentMessageRoute({
      parser: fixedParser({
        type: "create_booking",
        userId: "attacker",
        roomId: "506",
        date: "2026-08-01",
        timeRange: { startTime: "10:00", endTime: "11:00" },
      }),
      businessApiClient: createBusinessClient({
        async createBooking() {
          throw item.error;
        },
      }),
    });
    assert.equal(
      (await postAgentMessage(app, "预约", `request-${item.status}`)).status,
      item.status,
    );
  }
});

test("resolveDemoAgentAuth only grants admin from the server environment", () => {
  assert.deepEqual(
    resolveDemoAgentAuth({
      MEETING_ROOM_DEMO_USER_ID: "configured-user",
      DEMO_USER_ID: "legacy-user",
      MEETING_ROOM_DEMO_ROLE: "admin",
    }),
    {
      userId: "configured-user",
      role: "admin",
      authContext: { source: "demo", role: "admin" },
    },
  );
  assert.equal(
    resolveDemoAgentAuth({ MEETING_ROOM_DEMO_ROLE: "owner" }).role,
    "member",
  );
});

test("Agent API blocks management intents for the default member role", async () => {
  let mutationCalled = false;
  const app = createAgentMessageRoute({
    parser: fixedParser({
      type: "create_unavailability_rule",
      target: "506",
      date: "2026-08-05",
      timeRange: { startTime: "13:00", endTime: "18:00" },
      reason: "维修",
    }),
    businessApiClient: createBusinessClient({
      async createUnavailabilityRule() {
        mutationCalled = true;
        return {};
      },
    }),
    resolveAuth: () => ({
      userId: "member-user",
      role: "member",
      authContext: { source: "demo", role: "member" },
    }),
  });

  const response = await postAgentMessage(
    app,
    "把 506 设为维修",
    "request-member-rule",
  );
  assert.equal(response.status, 403);
  assert.equal(mutationCalled, false);
  assert.deepEqual(((await response.json()) as { error: AgentError }).error, {
    type: "permission_denied",
    message: "当前 Demo 身份没有会议室或规则管理权限。",
  });
});

async function postAgentMessage(
  app: Hono,
  message: string,
  requestId: string,
): Promise<Response> {
  return app.request("/api/agent/message", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      conversationId: "conversation-1",
      message,
      requestId,
    }),
  });
}

function fixedParser(intent: AgentIntent): AgentIntentParser {
  return {
    async parseIntent() {
      return { intent };
    },
  };
}

function createBusinessClient(
  overrides: Partial<BackendBusinessApiClient> = {},
): BackendBusinessApiClient {
  return {
    async checkAvailability() {
      return { availableRooms: [] };
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
    ...overrides,
  };
}
