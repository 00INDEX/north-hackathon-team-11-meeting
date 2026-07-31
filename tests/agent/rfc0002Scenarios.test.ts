import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { orchestrateAgentIntent } from "../../src/agent/businessApi.js";
import { formatAgentMessage } from "../../src/agent/formatter.js";
import { normalizeIntentTimeFields } from "../../src/agent/time.js";
import { parseAgentIntent } from "../../src/agent/schema.js";
import { createAgentMessageRoute } from "../../src/api/agent.js";
import type { BackendBusinessApiClient } from "../../src/agent/businessApi.js";
import type {
  ConversationHistoryEntry,
  NexParserRequest,
  NexParserResult,
} from "../../src/agent/nex.js";

const TODAY = "2026-07-29";

test("RFC-0002 scenario: next Tuesday small-room query excludes unavailable room 505", async () => {
  const calls: Array<{ endpoint: string; payload: unknown }> = [];
  const client = createScenarioBusinessApiClient({
    checkAvailability: async (request) => {
      calls.push({ endpoint: "/api/availability/check", payload: request });
      return {
        availableRooms: [
          {
            id: "room-506",
            name: "506",
            capacity: 6,
            type: "small",
            location: "A 座",
          },
          {
            id: "room-507",
            name: "507",
            capacity: 8,
            type: "small",
            location: "B 座",
          },
        ],
      };
    },
  });

  const orchestratorResult = await orchestrateAgentIntent(
    {
      type: "query_available_rooms",
      date: "2026-08-04",
      timeRange: { startTime: "10:00", endTime: "11:00" },
      filters: { roomType: "small" },
    },
    { userId: "u_001", client },
  );
  const reply = formatAgentMessage({
    intent: {
      type: "query_available_rooms",
      date: "2026-08-04",
      timeRange: { startTime: "10:00", endTime: "11:00" },
      filters: { roomType: "small" },
    },
    orchestratorResult,
  });

  assert.deepEqual(calls, [
    {
      endpoint: "/api/availability/check",
      payload: {
        date: "2026-08-04",
        startTime: "10:00",
        endTime: "11:00",
        filters: { roomType: "small" },
      },
    },
  ]);
  assert.equal(orchestratorResult.error, undefined);
  assert.deepEqual(orchestratorResult.data, {
    availableRooms: [
      {
        id: "room-506",
        name: "506",
        capacity: 6,
        type: "small",
        location: "A 座",
      },
      {
        id: "room-507",
        name: "507",
        capacity: 8,
        type: "small",
        location: "B 座",
      },
    ],
  });
  assert.match(reply.reply, /506/);
  assert.match(reply.reply, /507/);
  assert.doesNotMatch(reply.reply, /505/);
  assert.equal(reply.error, null);
});

test("RFC-0002 scenario: tomorrow noon activity-room booking reports lunch rule conflict", async () => {
  const calls: Array<{ endpoint: string; payload: unknown }> = [];
  const conflict = {
    type: "rule",
    id: "rule-activity-lunch-weekday",
    name: "活动室午餐规则",
    start: "2026-07-30T11:30:00+08:00",
    end: "2026-07-30T13:30:00+08:00",
    reason: "午餐时段不可预约",
  };
  const client = createScenarioBusinessApiClient({
    createBooking: async (request) => {
      const { idempotencyKey, ...payload } = request;
      assert.match(idempotencyKey ?? "", /^agent-[a-f0-9]{32}$/);
      calls.push({ endpoint: "/api/reservations", payload });
      throw {
        type: "conflict",
        message: "该时间段与活动室午餐规则冲突。",
        details: { conflicts: [conflict] },
      };
    },
  });

  const orchestratorResult = await orchestrateAgentIntent(
    {
      type: "create_booking",
      roomId: "room-activity",
      date: "2026-07-30",
      timeRange: { startTime: "11:30", endTime: "13:30" },
      title: "午餐会",
    },
    { userId: "u_001", client },
  );
  const reply = formatAgentMessage({
    intent: {
      type: "create_booking",
      roomId: "room-activity",
      date: "2026-07-30",
      timeRange: { startTime: "11:30", endTime: "13:30" },
      title: "午餐会",
    },
    orchestratorResult,
  });

  assert.deepEqual(calls, [
    {
      endpoint: "/api/reservations",
      payload: {
        userId: "u_001",
        roomId: "room-activity",
        date: "2026-07-30",
        startTime: "11:30",
        endTime: "13:30",
        title: "午餐会",
        description: undefined,
        attendees: undefined,
      },
    },
  ]);
  assert.deepEqual(orchestratorResult.error, {
    type: "conflict",
    message: "该时间段与活动室午餐规则冲突。",
    details: { conflicts: [conflict] },
  });
  assert.equal(orchestratorResult.actions[0].status, "failed");
  assert.equal(reply.error?.type, "conflict");
  assert.match(reply.reply, /预约冲突/);
  assert.match(reply.reply, /活动室午餐规则/);
  assert.match(reply.reply, /午餐时段不可预约/);
});

test("RFC-0002 scenario: combined room creation sends component room IDs and reports locked components", async () => {
  const calls: Array<{ endpoint: string; payload: unknown }> = [];
  const client = createScenarioBusinessApiClient({
    createCombinedRoom: async (request) => {
      const { idempotencyKey, userId, ...payload } = request;
      assert.equal(userId, "u_admin");
      assert.match(idempotencyKey ?? "", /^agent-[a-f0-9]{32}$/);
      calls.push({ endpoint: "/api/rooms/combined", payload });
      return {
        room: {
          id: request.combinedRoomId,
          name: "大会议室",
          capacity: 12,
          type: "combined",
          location: "A 座",
          componentRoomIds: ["room-meeting-1", "room-meeting-2"],
        },
      };
    },
  });

  const orchestratorResult = await orchestrateAgentIntent(
    {
      type: "create_combined_room",
      combinedRoomId: "combined_room_1_2",
      name: "大会议室",
      componentRoomIds: ["room-meeting-1", "room-meeting-2"],
      capacity: 12,
    },
    { userId: "u_admin", client },
  );
  const reply = formatAgentMessage({
    intent: {
      type: "create_combined_room",
      combinedRoomId: "combined_room_1_2",
      name: "大会议室",
      componentRoomIds: ["room-meeting-1", "room-meeting-2"],
      capacity: 12,
    },
    orchestratorResult,
  });

  assert.deepEqual(calls, [
    {
      endpoint: "/api/rooms/combined",
      payload: {
        combinedRoomId: "room-combined_room_1_2",
        name: "大会议室",
        componentRoomIds: ["room-meeting-1", "room-meeting-2"],
        capacity: 12,
        equipment: undefined,
      },
    },
  ]);
  assert.equal(orchestratorResult.error, undefined);
  assert.deepEqual(
    (orchestratorResult.data as { room: { componentRoomIds: string[] } }).room
      .componentRoomIds,
    ["room-meeting-1", "room-meeting-2"],
  );
  assert.match(reply.reply, /组合会议室 room-combined_room_1_2 创建成功/);
  assert.match(reply.reply, /room-meeting-1/);
  assert.match(reply.reply, /room-meeting-2/);
  assert.equal(reply.error, null);
});

test("RFC-0002 scenario: 506 rule correction updates the same rule instead of creating a new one", async () => {
  const calls: Array<{ endpoint: string; payload: unknown }> = [];
  const client = createScenarioBusinessApiClient({
    createUnavailabilityRule: async (request) => {
      const { idempotencyKey, userId, ...payload } = request;
      assert.equal(userId, "u_admin");
      assert.match(idempotencyKey ?? "", /^agent-[a-f0-9]{32}$/);
      calls.push({ endpoint: "/api/rules", payload });
      return {
        rule: {
          id: "rule-506-maintenance",
          target: "room-506",
          date: "2026-07-29",
          timeRange: { startTime: "00:00", endTime: "24:00" },
          reason: "临时维修",
        },
      };
    },
    updateUnavailabilityRule: async (request) => {
      const { idempotencyKey, userId, ...payload } = request;
      assert.equal(userId, "u_admin");
      assert.match(idempotencyKey ?? "", /^agent-[a-f0-9]{32}$/);
      calls.push({ endpoint: "/api/rules/rule-506-maintenance", payload });
      return {
        updatedRuleId: "rule-506-maintenance",
        rule: {
          id: "rule-506-maintenance",
          target: "room-506",
          date: "2026-07-29",
          timeRange: { startTime: "13:00", endTime: "18:00" },
          reason: "下午维修",
        },
      };
    },
  });

  const createResult = await orchestrateAgentIntent(
    {
      type: "create_unavailability_rule",
      target: "room-506",
      date: "2026-07-29",
      timeRange: { startTime: "00:00", endTime: "24:00" },
      reason: "临时维修",
    },
    { userId: "u_admin", client },
  );
  const updateResult = await orchestrateAgentIntent(
    {
      type: "update_last_unavailability_rule",
      ruleId: "rule-506-maintenance",
      target: "room-506",
      date: "2026-07-29",
      timeRange: { startTime: "13:00", endTime: "18:00" },
      reason: "下午维修",
    },
    { userId: "u_admin", client },
  );
  const reply = formatAgentMessage({
    intent: {
      type: "update_last_unavailability_rule",
      ruleId: "rule-506-maintenance",
      target: "room-506",
      date: "2026-07-29",
      timeRange: { startTime: "13:00", endTime: "18:00" },
      reason: "下午维修",
    },
    orchestratorResult: updateResult,
  });

  assert.deepEqual(calls, [
    {
      endpoint: "/api/rules",
      payload: {
        target: "room-506",
        date: "2026-07-29",
        timeRange: { startTime: "00:00", endTime: "24:00" },
        recurring: undefined,
        reason: "临时维修",
      },
    },
    {
      endpoint: "/api/rules/rule-506-maintenance",
      payload: {
        ruleId: "rule-506-maintenance",
        target: "room-506",
        date: "2026-07-29",
        timeRange: { startTime: "13:00", endTime: "18:00" },
        recurring: undefined,
        reason: "下午维修",
      },
    },
  ]);
  assert.equal(createResult.error, undefined);
  assert.equal(updateResult.error, undefined);
  assert.equal(createResult.actions.length, 1);
  assert.equal(updateResult.actions.length, 1);
  assert.equal(createResult.actions[0].endpoint, "/api/rules");
  assert.equal(
    updateResult.actions[0].endpoint,
    "/api/rules/rule-506-maintenance",
  );
  assert.deepEqual(updateResult.data, {
    updatedRuleId: "rule-506-maintenance",
    rule: {
      id: "rule-506-maintenance",
      target: "room-506",
      date: "2026-07-29",
      timeRange: { startTime: "13:00", endTime: "18:00" },
      reason: "下午维修",
    },
  });
  assert.match(reply.reply, /已更新规则 rule-506-maintenance/);
  assert.match(reply.reply, /目标：506/);
  assert.match(reply.reply, /13:00—18:00/);
  assert.equal(reply.error, null);
});

test("RFC-0002 scenario: end-to-end Agent API handles normalized 506 rule correction", async () => {
  const calls: Array<{ endpoint: string; payload: unknown }> = [];
  const app = createScenarioAgentApp({
    createUnavailabilityRule: async (request) => {
      calls.push({ endpoint: "/api/unavailability-rules", payload: request });
      return {
        rule: {
          id: "rule-506-maintenance",
          target: "room-506",
          date: "2026-07-29",
          timeRange: { startTime: "00:00", endTime: "24:00" },
          reason: "临时维修",
        },
      };
    },
    updateUnavailabilityRule: async (request) => {
      calls.push({
        endpoint: "/api/unavailability-rules/last",
        payload: request,
      });
      return {
        updatedRuleId: "rule-506-maintenance",
        rule: {
          id: "rule-506-maintenance",
          target: "room-506",
          date: "2026-07-29",
          timeRange: { startTime: "13:00", endTime: "18:00" },
          reason: "下午维修",
        },
      };
    },
  });

  const createResponse = await app.request("/api/agent/message", {
    method: "POST",
    body: JSON.stringify({
      userId: "u_admin",
      conversationId: "c_001",
      message: "这周三 506 临时维修，全天不能预约。",
      history: [],
    }),
    headers: { "content-type": "application/json" },
  });
  const updateResponse = await app.request("/api/agent/message", {
    method: "POST",
    body: JSON.stringify({
      userId: "u_admin",
      conversationId: "c_001",
      message: "刚才说错了，只停用下午。",
      history: [
        {
          role: "user",
          content: "这周三 506 临时维修，全天不能预约。",
        },
        {
          role: "assistant",
          content: "创建不可预约规则成功。",
          parsedIntent: {
            type: "create_unavailability_rule",
            target: "room-506",
            date: "2026-07-29",
            timeRange: { startTime: "00:00", endTime: "24:00" },
            reason: "临时维修",
          },
          actions: [
            {
              type: "create_unavailability_rule",
              endpoint: "/api/unavailability-rules",
            },
          ],
        },
      ],
    }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(createResponse.status, 200);
  assert.equal(updateResponse.status, 200);
  const createPayload = (await createResponse.json()) as Awaited<
    ReturnType<typeof createResponse.json>
  >;
  const updatePayload = (await updateResponse.json()) as Awaited<
    ReturnType<typeof updateResponse.json>
  >;

  assert.equal(createPayload.parsedIntent.type, "create_unavailability_rule");
  assert.equal(createPayload.parsedIntent.target, "room-506");
  assert.deepEqual(createPayload.parsedIntent.timeRange, {
    startTime: "00:00",
    endTime: "24:00",
  });
  assert.equal(
    updatePayload.parsedIntent.type,
    "update_last_unavailability_rule",
  );
  assert.deepEqual(updatePayload.parsedIntent.timeRange, {
    startTime: "13:00",
    endTime: "18:00",
  });
  assert.match(updatePayload.reply, /已更新规则 rule-506-maintenance/);
  assert.deepEqual(
    calls.map((call) => call.endpoint),
    ["/api/unavailability-rules", "/api/unavailability-rules/last"],
  );
  assert.equal(updatePayload.error, null);
});

function createScenarioBusinessApiClient(
  partialClient: Partial<BackendBusinessApiClient> = {},
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
    ...partialClient,
  };
}

function createScenarioAgentApp(
  partialClient: Partial<BackendBusinessApiClient> = {},
) {
  const app = new Hono();
  const businessApiClient = createScenarioBusinessApiClient(partialClient);

  app.route(
    "/",
    createAgentMessageRoute({
      parser: {
        async parseIntent(request: NexParserRequest): Promise<NexParserResult> {
          const rawIntent = inferIntentFromMessage(
            request.message,
            request.history ?? [],
          );
          const normalized = normalizeIntentTimeFields(rawIntent, {
            today: TODAY,
          });
          if (!normalized.valid) {
            return {
              error: {
                type: "parse_failed" as const,
                message: normalized.error.message,
              },
            };
          }
          const parsed = parseAgentIntent(JSON.stringify(normalized.intent));
          if (parsed.error) {
            return {
              error: {
                type: "parse_failed" as const,
                message: parsed.error.message,
                details: parsed.error.details,
              },
            };
          }
          return { intent: parsed.intent };
        },
      },
      businessApiClient,
    }),
  );

  return app;
}

function inferIntentFromMessage(
  message: string,
  history: ConversationHistoryEntry[],
): Record<string, unknown> {
  if (message.includes("506 临时维修")) {
    return {
      type: "create_unavailability_rule",
      target: "room-506",
      date: "这周三",
      timeRange: "全天",
      reason: "临时维修",
    };
  }

  if (message.includes("刚才说错了")) {
    const lastRuleIntent = [...history]
      .reverse()
      .find(
        (entry) =>
          entry.role === "assistant" &&
          isRecord(entry.parsedIntent) &&
          entry.parsedIntent.type === "create_unavailability_rule",
      );
    const lastParsedIntent =
      lastRuleIntent && isRecord(lastRuleIntent.parsedIntent)
        ? lastRuleIntent.parsedIntent
        : undefined;
    const target =
      lastParsedIntent && isRecord(lastParsedIntent.target)
        ? "room-506"
        : "room-506";
    const date =
      lastParsedIntent && isRecord(lastParsedIntent.date)
        ? "2026-07-29"
        : "2026-07-29";
    return {
      type: "update_last_unavailability_rule",
      target,
      date,
      timeRange: "下午",
      reason: "下午维修",
    };
  }

  if (message.includes("活动室")) {
    return {
      type: "create_booking",
      roomId: "room-activity",
      date: "明天",
      timeRange: "中午",
      title: "午餐会",
    };
  }

  if (message.includes("会议室一") && message.includes("会议室二")) {
    return {
      type: "create_combined_room",
      combinedRoomId: "combined_room_1_2",
      name: "大会议室",
      componentRoomIds: ["room-meeting-1", "room-meeting-2"],
      capacity: 12,
    };
  }

  if (message.includes("小会议室")) {
    return {
      type: "query_available_rooms",
      date: "下周二",
      timeRange: "10:00-11:00",
      filters: { roomType: "small" },
    };
  }

  return {
    type: "need_clarification",
    missingFields: ["date", "timeRange"],
    clarification: "请补充日期和时间。",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
