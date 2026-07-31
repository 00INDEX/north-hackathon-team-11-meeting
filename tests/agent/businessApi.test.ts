import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  createBusinessApiClient,
  createStableIdempotencyKey,
  orchestrateAgentIntent,
  resolveRoomReference,
  type BackendBusinessApiClient,
  type ConflictDetail,
} from "../../src/agent/businessApi.js";

test("orchestrateAgentIntent maps query_available_rooms to RFC-0001 availability API", async () => {
  const client = mockBusinessApiClient({
    checkAvailability: async (request) => {
      assert.deepEqual(request, {
        date: "2026-08-04",
        startTime: "10:00",
        endTime: "11:00",
        filters: { roomType: "small" },
      });
      return {
        availableRooms: [
          {
            id: "room-506",
            name: "506",
            capacity: 6,
            type: "small",
            location: "A 座",
          },
        ],
      };
    },
  });

  const result = await orchestrateAgentIntent(
    {
      type: "query_available_rooms",
      date: "2026-08-04",
      timeRange: { startTime: "10:00", endTime: "11:00" },
      filters: { roomType: "small" },
    },
    { userId: "u_001", client },
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.actions, [
    {
      type: "query_available_rooms",
      status: "completed",
      endpoint: "/api/availability",
      payload: {
        method: "GET",
        query: {
          start: "2026-08-04T02:00:00.000Z",
          end: "2026-08-04T03:00:00.000Z",
        },
      },
      result: {
        availableRooms: [
          {
            id: "room-506",
            name: "506",
            capacity: 6,
            type: "small",
            location: "A 座",
          },
        ],
      },
    },
  ]);
  assert.deepEqual(result.data, {
    availableRooms: [
      {
        id: "room-506",
        name: "506",
        capacity: 6,
        type: "small",
        location: "A 座",
      },
    ],
  });
});

test("orchestrateAgentIntent maps create_booking to RFC-0001 reservations API", async () => {
  let capturedIdempotencyKey = "";
  const client = mockBusinessApiClient({
    createBooking: async (request) => {
      capturedIdempotencyKey = request.idempotencyKey ?? "";
      assert.deepEqual(
        {
          ...request,
          idempotencyKey: "<stable>",
        },
        {
          userId: "server-user",
          roomId: "room-506",
          date: "2026-08-05",
          startTime: "10:00",
          endTime: "11:00",
          title: "项目讨论",
          description: "需求评审",
          attendees: 6,
          idempotencyKey: "<stable>",
        },
      );
      assert.match(capturedIdempotencyKey, /^agent-[a-f0-9]{32}$/);
      return {
        booking: {
          id: "booking-1",
          title: "项目讨论",
          roomId: "room-506",
          date: "2026-08-05",
          startTime: "10:00",
          endTime: "11:00",
          status: "active",
        },
      };
    },
  });

  const result = await orchestrateAgentIntent(
    {
      type: "create_booking",
      roomId: "room-506",
      date: "2026-08-05",
      timeRange: { startTime: "10:00", endTime: "11:00" },
      title: "项目讨论",
      description: "需求评审",
      attendees: 6,
    },
    {
      userId: "server-user",
      conversationId: "conversation-1",
      requestId: "request-1",
      authContext: { role: "member" },
      client,
    },
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.actions, [
    {
      type: "create_booking",
      status: "completed",
      endpoint: "/api/reservations",
      payload: {
        method: "POST",
        body: {
          id: `reservation-${capturedIdempotencyKey}`,
          title: "项目讨论",
          description: "需求评审",
          roomId: "room-506",
          start: "2026-08-05T02:00:00.000Z",
          end: "2026-08-05T03:00:00.000Z",
        },
        headers: {
          "x-actor": "server-user",
          "x-idempotency-key": capturedIdempotencyKey,
        },
      },
      result: {
        booking: {
          id: "booking-1",
          title: "项目讨论",
          roomId: "room-506",
          date: "2026-08-05",
          startTime: "10:00",
          endTime: "11:00",
          status: "active",
        },
      },
    },
  ]);
});

test("orchestrateAgentIntent maps cancel_booking to RFC-0001 reservation cancel API", async () => {
  let capturedIdempotencyKey = "";
  const client = mockBusinessApiClient({
    cancelBooking: async (request) => {
      assert.equal(request.bookingId, "booking-1");
      assert.equal(request.userId, "u_001");
      capturedIdempotencyKey = request.idempotencyKey ?? "";
      return {
        booking: {
          id: "booking-1",
          title: "项目讨论",
          roomId: "room-506",
          date: "2026-08-05",
          startTime: "10:00",
          endTime: "11:00",
          status: "cancelled",
        },
      };
    },
  });

  const result = await orchestrateAgentIntent(
    {
      type: "cancel_booking",
      bookingId: "booking-1",
    },
    { userId: "u_001", client },
  );

  assert.equal(result.error, undefined);
  assert.deepEqual(result.actions, [
    {
      type: "cancel_booking",
      status: "completed",
      endpoint: "/api/reservations/booking-1/cancel",
      payload: {
        method: "POST",
        body: { reason: "由会议室 Agent 取消" },
        headers: {
          "x-actor": "u_001",
          "x-idempotency-key": capturedIdempotencyKey,
        },
      },
      result: {
        booking: {
          id: "booking-1",
          title: "项目讨论",
          roomId: "room-506",
          date: "2026-08-05",
          startTime: "10:00",
          endTime: "11:00",
          status: "cancelled",
        },
      },
    },
  ]);
});

test("orchestrateAgentIntent maps unavailability rule create and update to RFC-0001 rules API", async () => {
  const idempotencyKeys: string[] = [];
  const client = mockBusinessApiClient({
    createUnavailabilityRule: async (request) => {
      assert.equal(request.target, "room-506");
      assert.equal(request.date, "2026-08-05");
      assert.deepEqual(request.timeRange, {
        startTime: "00:00",
        endTime: "24:00",
      });
      assert.equal(request.reason, "临时维修");
      idempotencyKeys.push(request.idempotencyKey ?? "");
      return { rule: { id: "rule-1", target: "room-506", reason: "临时维修" } };
    },
    updateUnavailabilityRule: async (request) => {
      assert.equal(request.ruleId, "rule-1");
      assert.deepEqual(request.timeRange, {
        startTime: "13:00",
        endTime: "18:00",
      });
      assert.equal(request.reason, "下午维修");
      idempotencyKeys.push(request.idempotencyKey ?? "");
      return { rule: { id: "rule-1", target: "room-506", reason: "下午维修" } };
    },
  });

  const createResult = await orchestrateAgentIntent(
    {
      type: "create_unavailability_rule",
      target: "room-506",
      date: "2026-08-05",
      timeRange: { startTime: "00:00", endTime: "24:00" },
      reason: "临时维修",
    },
    { userId: "u_001", client },
  );

  assert.equal(createResult.error, undefined);
  assert.equal(createResult.actions[0].endpoint, "/api/rules");
  assert.deepEqual(createResult.actions[0].payload, {
    method: "POST",
    body: {
      targetType: "room",
      targetId: "room-506",
      ruleType: "one_time_block",
      reason: "临时维修",
      start: "2026-08-04T16:00:00.000Z",
      end: "2026-08-05T16:00:00.000Z",
    },
    headers: {
      "x-actor": "u_001",
      "x-idempotency-key": idempotencyKeys[0],
    },
  });

  const updateResult = await orchestrateAgentIntent(
    {
      type: "update_last_unavailability_rule",
      ruleId: "rule-1",
      timeRange: { startTime: "13:00", endTime: "18:00" },
      reason: "下午维修",
    },
    { userId: "u_001", client },
  );

  assert.equal(updateResult.error, undefined);
  assert.deepEqual(updateResult.actions, [
    {
      type: "update_last_unavailability_rule",
      status: "completed",
      endpoint: "/api/rules/rule-1",
      payload: {
        method: "PATCH",
        headers: {
          "x-actor": "u_001",
          "x-idempotency-key": idempotencyKeys[1],
        },
      },
      result: {
        rule: { id: "rule-1", target: "room-506", reason: "下午维修" },
      },
    },
  ]);
});

test("orchestrateAgentIntent maps room config and combined room to RFC-0001 room APIs", async () => {
  const client = mockBusinessApiClient({
    createOrUpdateRoom: async (request) => {
      assert.equal(request.roomId, "room-506");
      assert.equal(request.name, "506 会议室");
      assert.equal(request.capacity, 8);
      assert.equal(request.roomType, "medium");
      assert.deepEqual(request.equipment, ["screen"]);
      return {
        room: {
          id: "room-506",
          name: "506 会议室",
          capacity: 8,
          type: "medium",
          location: "A 座",
        },
      };
    },
    createCombinedRoom: async (request) => {
      assert.equal(request.combinedRoomId, "room-combined_room_1_2");
      assert.deepEqual(request.componentRoomIds, ["room-1", "room-2"]);
      return {
        room: {
          id: request.combinedRoomId,
          name: "大会议室",
          capacity: 12,
          type: "组合会议室",
          location: "A 座",
          componentRoomIds: request.componentRoomIds,
        },
      };
    },
  });

  const roomResult = await orchestrateAgentIntent(
    {
      type: "create_or_update_room",
      roomId: "room-506",
      name: "506 会议室",
      capacity: 8,
      roomType: "medium",
      equipment: ["screen"],
    },
    { userId: "u_admin", client },
  );

  assert.equal(roomResult.error, undefined);
  assert.equal(roomResult.actions[0].endpoint, "/api/rooms");
  assert.equal(roomResult.actions[0].status, "completed");
  assert.equal(
    (roomResult.actions[0].payload as { method: string }).method,
    "GET",
  );
  assert.match(
    (
      roomResult.actions[0].payload as {
        then: Array<{ headers: Record<string, string> }>;
      }
    ).then[0].headers["x-idempotency-key"],
    /^agent-[a-f0-9]{32}$/,
  );

  const combinedResult = await orchestrateAgentIntent(
    {
      type: "create_combined_room",
      combinedRoomId: "combined_room_1_2",
      name: "大会议室",
      componentRoomIds: ["room-1", "room-2"],
      capacity: 12,
    },
    { userId: "u_admin", client },
  );

  assert.equal(combinedResult.error, undefined);
  assert.equal(combinedResult.actions[0].endpoint, "/api/rooms/combined");
  assert.equal(combinedResult.actions[0].status, "completed");
  assert.deepEqual(
    (
      combinedResult.actions[0].payload as {
        body: { id: string; componentRoomIds: string[] };
      }
    ).body,
    {
      id: "room-combined_room_1_2",
      name: "大会议室",
      componentRoomIds: ["room-1", "room-2"],
      capacity: 12,
    },
  );
});

test("orchestrateAgentIntent returns no action for need_clarification", async () => {
  const client = mockBusinessApiClient();

  const result = await orchestrateAgentIntent(
    {
      type: "need_clarification",
      missingFields: ["date", "timeRange"],
      clarification: "请补充日期和时间。",
    },
    { userId: "u_001", client },
  );

  assert.deepEqual(result, { actions: [] });
});

test("orchestrateAgentIntent propagates backend conflict errors without mutating action status to completed", async () => {
  const conflict: ConflictDetail = {
    type: "rule",
    id: "rule-activity-lunch",
    name: "活动室午餐规则",
    start: "2026-08-05T11:30:00+08:00",
    end: "2026-08-05T13:30:00+08:00",
    reason: "午餐时段不可预约",
  };
  const client = mockBusinessApiClient({
    createBooking: async () => {
      throw {
        type: "conflict",
        message: "该时间段与现有规则冲突。",
        details: { conflicts: [conflict] },
      };
    },
  });

  const result = await orchestrateAgentIntent(
    {
      type: "create_booking",
      roomId: "room-activity",
      date: "2026-08-05",
      timeRange: { startTime: "12:00", endTime: "13:00" },
      userId: "u_001",
    },
    { userId: "u_001", client },
  );

  assert.deepEqual(result.error, {
    type: "conflict",
    message: "该时间段与现有规则冲突。",
    details: { conflicts: [conflict] },
  });
  assert.equal(result.actions[0].status, "failed");
  assert.equal(result.actions[0].error?.type, "conflict");
});

test("orchestrateAgentIntent propagates backend permission_denied errors", async () => {
  const client = mockBusinessApiClient({
    createUnavailabilityRule: async () => {
      throw {
        type: "permission_denied",
        message: "当前用户无权限创建不可预约规则。",
      };
    },
  });

  const result = await orchestrateAgentIntent(
    {
      type: "create_unavailability_rule",
      target: "room-506",
      reason: "临时维修",
    },
    { userId: "u_member", client },
  );

  assert.deepEqual(result.error, {
    type: "permission_denied",
    message: "当前用户无权限创建不可预约规则。",
  });
  assert.equal(result.actions[0].status, "failed");
  assert.equal(result.actions[0].error?.type, "permission_denied");
});

test("createBusinessApiClient sends RFC backend business API contracts", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: input.toString(), init });
    const path = input.toString().replace("https://backend.example.test", "");
    if (path.startsWith("/api/availability?")) {
      return jsonResponse([backendRoom()]);
    }
    if (path === "/api/reservations") {
      const body = await inputToRequest(input, init)
        .then((request) => request.json())
        .catch(() => undefined);
      return jsonResponse(
        body
          ? {
              id: "booking-1",
              title: "项目讨论",
              roomId: "room-506",
              start: "2026-08-05T02:00:00.000Z",
              end: "2026-08-05T03:00:00.000Z",
              status: "active",
            }
          : [
              {
                id: "booking-1",
                title: "项目讨论",
                roomId: "room-506",
                start: "2026-08-05T02:00:00.000Z",
                end: "2026-08-05T03:00:00.000Z",
                status: "active",
              },
            ],
      );
    }
    if (path === "/api/reservations/booking-1/cancel") {
      return jsonResponse({
        id: "booking-1",
        title: "项目讨论",
        roomId: "room-506",
        start: "2026-08-05T02:00:00.000Z",
        end: "2026-08-05T03:00:00.000Z",
        status: "cancelled",
      });
    }
    if (path === "/api/rooms") {
      return jsonResponse([backendRoom()]);
    }
    if (path === "/api/rules") {
      return jsonResponse(backendRule());
    }
    if (path === "/api/rules/rule-1" && init?.method === "GET") {
      return jsonResponse(backendRule());
    }
    if (path === "/api/rules/rule-1") {
      return jsonResponse({ ...backendRule(), reason: "下午维修" });
    }
    if (path === "/api/rooms/room-506") {
      return jsonResponse({ ...backendRoom(), capacity: 8 });
    }
    if (path === "/api/rooms/combined") {
      return jsonResponse({
        ...backendRoom(),
        id: "room-combined",
        name: "组合会议室",
        type: "组合会议室",
        componentRoomIds: ["room-506", "room-507"],
      });
    }
    return jsonResponse({});
  };

  try {
    const client = createBusinessApiClient({
      baseUrl: "https://backend.example.test",
    });

    await client.checkAvailability({
      date: "2026-08-04",
      startTime: "10:00",
      endTime: "11:00",
    });
    await client.createBooking({
      userId: "u_001",
      roomId: "room-506",
      date: "2026-08-05",
      startTime: "10:00",
      endTime: "11:00",
    });
    await client.cancelBooking({ bookingId: "booking-1" });
    await client.conflictCheck({
      roomId: "room-506",
      date: "2026-08-05",
      startTime: "10:00",
      endTime: "11:00",
    });
    await client.listRooms();
    await client.createUnavailabilityRule({
      target: "room-506",
      date: "2026-08-05",
      reason: "维修",
    });
    await client.updateUnavailabilityRule({
      ruleId: "rule-1",
      reason: "下午维修",
    });
    await client.createOrUpdateRoom({ roomId: "room-506", capacity: 8 });
    await client.createCombinedRoom({
      combinedRoomId: "room-combined",
      componentRoomIds: ["room-506", "room-507"],
    });

    assert.deepEqual(
      requests.map((request) => [request.url, request.init?.method]),
      [
        [
          "https://backend.example.test/api/availability?start=2026-08-04T02%3A00%3A00.000Z&end=2026-08-04T03%3A00%3A00.000Z",
          "GET",
        ],
        ["https://backend.example.test/api/reservations", "POST"],
        [
          "https://backend.example.test/api/reservations/booking-1/cancel",
          "POST",
        ],
        [
          "https://backend.example.test/api/availability?start=2026-08-05T02%3A00%3A00.000Z&end=2026-08-05T03%3A00%3A00.000Z",
          "GET",
        ],
        ["https://backend.example.test/api/rooms", "GET"],
        ["https://backend.example.test/api/rules", "POST"],
        ["https://backend.example.test/api/rules/rule-1", "GET"],
        ["https://backend.example.test/api/rules/rule-1", "PATCH"],
        ["https://backend.example.test/api/rooms", "GET"],
        ["https://backend.example.test/api/rooms/room-506", "PATCH"],
        ["https://backend.example.test/api/rooms/combined", "POST"],
      ],
    );
    assert.ok(
      !requests.some((request) => request.url.includes("/api/bookings")),
    );
    assert.ok(
      !requests.some((request) =>
        request.url.includes("/api/unavailability-rules"),
      ),
    );
    assert.ok(
      !requests.some((request) =>
        request.url.includes("/api/availability/check"),
      ),
    );
    assert.ok(
      !requests.some((request) => request.url.includes("/api/room-groups")),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("createBusinessApiClient maps backend permission and conflict HTTP errors", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "RESERVATION_CONFLICT",
          message: "该房间已被预约。",
          conflicts: [
            { type: "reservation", id: "booking-1", name: "项目讨论" },
          ],
        },
      }),
      { status: 409, headers: { "content-type": "application/json" } },
    );

  try {
    const client = createBusinessApiClient({
      baseUrl: "https://backend.example.test",
    });

    await assert.rejects(
      client.createBooking({
        userId: "u_001",
        roomId: "room-506",
        date: "2026-08-05",
        startTime: "10:00",
        endTime: "11:00",
      }),
      (error) => {
        assert.deepEqual(error, {
          type: "conflict",
          message: "该房间已被预约。",
          details: {
            httpStatus: 409,
            code: "RESERVATION_CONFLICT",
            conflicts: [
              { type: "reservation", id: "booking-1", name: "项目讨论" },
            ],
          },
        });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "PERMISSION_DENIED",
          message: "无权限。",
        },
      }),
      { status: 403, headers: { "content-type": "application/json" } },
    );

  try {
    const client = createBusinessApiClient({
      baseUrl: "https://backend.example.test",
    });

    await assert.rejects(
      client.createUnavailabilityRule({
        target: "room-506",
        date: "2026-08-05",
        reason: "维修",
      }),
      (error) => {
        assert.deepEqual(error, {
          type: "permission_denied",
          message: "无权限。",
          details: {
            httpStatus: 403,
            code: "PERMISSION_DENIED",
            conflicts: undefined,
          },
        });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveRoomReference handles IDs, names, aliases, missing rooms, and ambiguity", () => {
  const rooms = [
    backendRoom({ id: "room-506", name: "506 会议室", location: "A 座" }),
    backendRoom({ id: "room-507", name: "507 会议室", location: "B 座" }),
    backendRoom({ id: "room-east-1", name: "东侧讨论室", location: "A 座" }),
    backendRoom({ id: "room-east-2", name: "东侧培训室", location: "B 座" }),
  ];

  assert.equal(resolveRoomReference("room-506", rooms)?.id, "room-506");
  assert.equal(resolveRoomReference("506", rooms)?.id, "room-506");
  assert.equal(resolveRoomReference("507会议室", rooms)?.id, "room-507");
  assert.equal(
    resolveRoomReference("不存在", rooms, { allowNotFound: true }),
    undefined,
  );
  assert.throws(
    () => resolveRoomReference("东侧", rooms),
    (error) => {
      assert.equal((error as { type?: string }).type, "need_clarification");
      assert.equal(
        (error as { details?: { rooms?: unknown[] } }).details?.rooms?.length,
        2,
      );
      return true;
    },
  );
});

test("createBusinessApiClient cancels only a unique reservation candidate", async () => {
  const candidates = [
    {
      id: "reservation-1",
      title: "项目讨论",
      roomId: "room-506",
      start: "2026-08-05T02:00:00.000Z",
      end: "2026-08-05T03:00:00.000Z",
      status: "active",
    },
  ];
  const calls: string[] = [];
  const client = createBusinessApiClient({
    baseUrl: "https://backend.example.test",
    maxRetries: 0,
    fetchImpl: async (input) => {
      const url = input.toString();
      calls.push(url);
      return url.includes("/cancel")
        ? jsonResponse({ ...candidates[0], status: "cancelled" })
        : jsonResponse(candidates);
    },
  });

  const result = await client.cancelBooking({
    roomId: "room-506",
    date: "2026-08-05",
    title: "项目讨论",
    userId: "server-user",
    idempotencyKey: "stable-cancel-key",
  });

  assert.equal(result.booking?.id, "reservation-1");
  assert.equal(result.booking?.status, "cancelled");
  assert.equal(calls.length, 2);
  assert.match(calls[0], /\/api\/reservations\?/);
  assert.match(calls[1], /\/api\/reservations\/reservation-1\/cancel$/);
});

test("createBusinessApiClient rejects zero or ambiguous cancellation candidates", async () => {
  for (const candidates of [
    [],
    [
      {
        id: "reservation-1",
        title: "项目讨论",
        roomId: "room-506",
        start: "2026-08-05T02:00:00.000Z",
        end: "2026-08-05T03:00:00.000Z",
        status: "active",
      },
      {
        id: "reservation-2",
        title: "项目讨论",
        roomId: "room-506",
        start: "2026-08-05T04:00:00.000Z",
        end: "2026-08-05T05:00:00.000Z",
        status: "active",
      },
    ],
  ]) {
    const client = createBusinessApiClient({
      baseUrl: "https://backend.example.test",
      maxRetries: 0,
      fetchImpl: async () => jsonResponse(candidates),
    });
    await assert.rejects(
      client.cancelBooking({ roomId: "room-506", date: "2026-08-05" }),
      (error) => {
        assert.equal(
          (error as { type?: string }).type,
          candidates.length === 0 ? "not_found" : "need_clarification",
        );
        return true;
      },
    );
  }
});

test("business adapter rejects malformed 2xx payloads instead of reporting success", async () => {
  for (const response of [
    new Response("", { status: 200 }),
    new Response("<html>ok</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
    jsonResponse({}),
  ]) {
    const client = createBusinessApiClient({
      baseUrl: "https://backend.example.test",
      maxRetries: 0,
      fetchImpl: async () => response.clone(),
    });
    await assert.rejects(client.listRooms(), (error) => {
      assert.equal((error as { type?: string }).type, "backend_unavailable");
      return true;
    });
  }
});

test("business adapter retries safe requests and uses stable idempotency keys", async () => {
  let calls = 0;
  const client = createBusinessApiClient({
    baseUrl: "https://backend.example.test",
    maxRetries: 1,
    retryBaseDelayMs: 0,
    fetchImpl: async () => {
      calls += 1;
      return calls === 1
        ? new Response("unavailable", { status: 503 })
        : jsonResponse([backendRoom()]);
    },
  });

  assert.equal((await client.listRooms()).length, 1);
  assert.equal(calls, 2);
  assert.equal(
    createStableIdempotencyKey("create_booking", {
      roomId: "room-506",
      title: "项目讨论",
    }),
    createStableIdempotencyKey("create_booking", {
      title: "项目讨论",
      roomId: "room-506",
    }),
  );
});

test("validateStartupEnvironment creates default database parent directory without printing secrets", async () => {
  const { validateStartupEnvironment } =
    await import("../../src/config/startupEnv.js");
  const originalDataDir = process.env.DATA_DIR;
  const tempRoot = mkdtempSync(path.join(tmpdir(), "meeting-room-data-"));
  const dataDir = path.join(tempRoot, "nested", "data");
  process.env.DATA_DIR = dataDir;
  process.env.NEX_API_BASE_URL = "https://nex.example.test";
  process.env.NEX_API_KEY = "secret-key-should-not-print";
  process.env.NEX_MODEL = "test-model";
  process.env.MEETING_ROOM_API_BASE_URL = "https://backend.example.test";

  try {
    assert.doesNotThrow(validateStartupEnvironment);
    assert.equal(existsSync(dataDir), true);
  } finally {
    if (originalDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = originalDataDir;
    }
    rmSync(tempRoot, { recursive: true, force: true });
  }
});

test("validateStartupEnvironment reports only missing variable names", async () => {
  const { validateStartupEnvironment } =
    await import("../../src/config/startupEnv.js");
  const originalEnv = { ...process.env };
  process.env.NEX_API_BASE_URL = "https://nex.example.test";
  process.env.NEX_API_KEY = "secret-key-should-not-print";
  process.env.NEX_MODEL = "test-model";
  process.env.MEETING_ROOM_API_BASE_URL = "https://backend.example.test";
  delete process.env.NEX_API_KEY;

  try {
    assert.throws(validateStartupEnvironment, (error) => {
      assert.equal(
        error instanceof Error ? error.message.includes("NEX_API_KEY") : false,
        true,
      );
      assert.equal(
        error instanceof Error
          ? error.message.includes("secret-key-should-not-print")
          : false,
        false,
      );
      return true;
    });
  } finally {
    process.env = originalEnv;
  }
});

function mockBusinessApiClient(
  partialClient: Partial<BackendBusinessApiClient> = {},
): BackendBusinessApiClient {
  return {
    checkAvailability: async () => ({ availableRooms: [] }),
    createBooking: async () => ({
      booking: {
        id: "booking-1",
        title: "",
        roomId: "",
        date: "",
        startTime: "",
        endTime: "",
        status: "active",
      },
    }),
    cancelBooking: async () => ({
      booking: {
        id: "booking-1",
        title: "",
        roomId: "",
        date: "",
        startTime: "",
        endTime: "",
        status: "cancelled",
      },
    }),
    conflictCheck: async () => ({ available: true }),
    listRooms: async () => [],
    createUnavailabilityRule: async () => ({}),
    updateUnavailabilityRule: async () => ({}),
    createOrUpdateRoom: async () => ({}),
    createCombinedRoom: async () => ({}),
    ...partialClient,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function backendRoom(overrides: Record<string, unknown> = {}) {
  return {
    id: "room-506",
    name: "506",
    type: "小会议室",
    capacity: 6,
    location: "A 座",
    equipment: [],
    enabled: true,
    version: 1,
    ...overrides,
  };
}

function backendRule(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1",
    targetType: "room",
    targetId: "room-506",
    ruleType: "one_time_block",
    reason: "维修",
    start: "2026-08-04T16:00:00.000Z",
    end: "2026-08-05T16:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

async function inputToRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Request> {
  return input instanceof Request ? input : new Request(input, init);
}
