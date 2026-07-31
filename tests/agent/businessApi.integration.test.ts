import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Hono } from "hono";
import {
  createBusinessApiClient,
  orchestrateAgentIntent,
} from "../../src/agent/businessApi.js";
import {
  closeDatabase,
  openDatabase,
  runMigrations,
} from "../../src/db/index.js";
import { seedDatabase } from "../../src/db/seedData.js";
import { appErrorHandler } from "../../src/errors/hono.js";
import { createAvailabilityRoutes } from "../../src/server/routes/availabilityRoutes.js";
import { createReservationRoutes } from "../../src/server/routes/reservationRoutes.js";
import { createRoomRoutes } from "../../src/server/routes/roomRoutes.js";
import { createRuleRoutes } from "../../src/server/routes/ruleRoutes.js";

test("Agent adapter executes RFC-0001 APIs against real SQLite with idempotent mutations", async () => {
  const tempDir = mkdtempSync(
    path.join(os.tmpdir(), "meeting-room-agent-adapter-"),
  );
  const db = openDatabase({
    filePath: path.join(tempDir, "meeting-room.sqlite3"),
  });
  try {
    runMigrations(db);
    seedDatabase(db);
    const app = new Hono();
    app.onError(appErrorHandler);
    app.route("/api/rooms", createRoomRoutes(db));
    app.route("/api/rules", createRuleRoutes(db));
    app.route("/api", createAvailabilityRoutes(db));
    app.route("/api/reservations", createReservationRoutes(db));

    const client = createBusinessApiClient({
      baseUrl: "https://local.test",
      maxRetries: 0,
      fetchImpl: async (input, init) =>
        await app.fetch(toLocalRequest(input, init)),
    });
    const context = {
      userId: "local-user",
      conversationId: "conversation-integration",
      requestId: "request-create-booking",
      client,
    };
    const bookingIntent = {
      type: "create_booking" as const,
      roomId: "506",
      date: "2026-08-04",
      timeRange: { startTime: "10:00", endTime: "11:00" },
      title: "Agent SQLite 联调",
    };

    const first = await orchestrateAgentIntent(bookingIntent, context);
    const replay = await orchestrateAgentIntent(bookingIntent, context);
    assert.equal(first.error, undefined);
    assert.equal(replay.error, undefined);
    const reservationId = (first.data as { booking: { id: string } }).booking
      .id;
    assert.equal(
      (replay.data as { booking: { id: string } }).booking.id,
      reservationId,
    );

    const reservationsResponse = await app.request("/api/reservations");
    const reservationsBeforeCancel =
      (await reservationsResponse.json()) as Array<{
        id: string;
        title: string;
        status: string;
      }>;
    assert.equal(
      reservationsBeforeCancel.filter(
        (item) => item.title === "Agent SQLite 联调",
      ).length,
      1,
    );

    const cancel = await orchestrateAgentIntent(
      {
        type: "cancel_booking",
        roomId: "506",
        date: "2026-08-04",
        title: "Agent SQLite 联调",
      },
      {
        ...context,
        requestId: "request-cancel-booking",
      },
    );
    assert.equal(cancel.error, undefined);
    assert.equal(
      (cancel.data as { booking: { status: string } }).booking.status,
      "cancelled",
    );

    const createRule = await orchestrateAgentIntent(
      {
        type: "create_unavailability_rule",
        target: "506",
        date: "2026-08-04",
        timeRange: { startTime: "13:00", endTime: "18:00" },
        reason: "下午维修",
      },
      {
        ...context,
        requestId: "request-create-rule",
      },
    );
    assert.equal(createRule.error, undefined);
    const ruleId = (createRule.data as { rule: { id: string } }).rule.id;

    const updateRule = await orchestrateAgentIntent(
      {
        type: "update_last_unavailability_rule",
        ruleId,
        date: "2026-08-04",
        timeRange: { startTime: "14:00", endTime: "18:00" },
        reason: "下午两点开始维修",
      },
      {
        ...context,
        requestId: "request-update-rule",
      },
    );
    assert.equal(updateRule.error, undefined);
    assert.equal(
      (updateRule.data as { updatedRuleId: string }).updatedRuleId,
      ruleId,
    );

    const combined = await orchestrateAgentIntent(
      {
        type: "create_combined_room",
        combinedRoomId: "agent-combined",
        name: "Agent 组合会议室",
        componentRoomIds: ["room-meeting-1", "room-meeting-2"],
      },
      {
        ...context,
        requestId: "request-create-combined",
      },
    );
    assert.equal(combined.error, undefined);
    assert.equal(
      (combined.data as { room: { id: string } }).room.id,
      "room-agent-combined",
    );
    assert.equal(combined.actions[0].endpoint, "/api/rooms/combined");
  } finally {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function toLocalRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  const original = input instanceof Request ? input : new Request(input, init);
  const url = new URL(original.url);
  return new Request(`http://local.test${url.pathname}${url.search}`, original);
}
