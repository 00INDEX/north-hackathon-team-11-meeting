import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBusinessApiClient } from "@/agent/businessApi";
import type { AgentIntentParser } from "@/api/agent";
import {
  closeDatabase,
  openDatabase,
  runMigrations,
  type Database,
} from "@/db";
import { seedDatabase } from "@/db/seedData";
import { AvailabilityRuleRepository } from "@/persistence/sqlite/AvailabilityRuleRepository";
import { ConversationHistoryRepository } from "@/persistence/sqlite/ConversationHistoryRepository";
import { ReservationRepository } from "@/persistence/sqlite/ReservationRepository";
import { createApp } from "@/server";

describe("RFC-0004 Agent -> authoritative API -> SQLite flow", () => {
  let app: Hono;
  let db: Database;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(os.tmpdir(), "meeting-room-agent-e2e-"));
    db = openDatabase({
      filePath: path.join(tempDir, "meeting-room.sqlite3"),
    });
    runMigrations(db);
    seedDatabase(db);

    const internalFetch: typeof fetch = async (input, init) => {
      const request =
        input instanceof Request
          ? new Request(input, init)
          : new Request(input, init);
      return app.fetch(request);
    };
    const businessApiClient = createBusinessApiClient({
      baseUrl: "http://meeting-room.test",
      fetchImpl: internalFetch,
      maxRetries: 0,
    });
    app = createApp(db, {
      agent: {
        parser: scenarioParser(),
        businessApiClient,
        resolveAuth: () => ({
          userId: "integration-admin",
          role: "admin",
          authContext: { source: "demo", role: "admin" },
        }),
      },
    });
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates and cancels one reservation, then updates the same persisted rule from history", async () => {
    const booking = await sendAgentMessage("预约 506", "request-booking");
    expect(booking.status).toBe(200);
    expect(booking.body.error).toBeNull();
    expect(booking.body.actions).toEqual([
      expect.objectContaining({
        type: "create_booking",
        status: "completed",
        endpoint: "/api/reservations",
      }),
    ]);

    const reservationRepository = new ReservationRepository(db);
    const active = reservationRepository.list({ status: "active" });
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      roomId: "room-506",
      title: "项目讨论",
      status: "active",
    });

    const cancellation = await sendAgentMessage(
      "取消刚才的预约",
      "request-cancel",
    );
    expect(cancellation.status).toBe(200);
    expect(reservationRepository.findById(active[0].id)).toMatchObject({
      id: active[0].id,
      status: "cancelled",
    });

    const createdRule = await sendAgentMessage(
      "506 全天维修",
      "request-rule-create",
    );
    expect(createdRule.status).toBe(200);
    const ruleRepository = new AvailabilityRuleRepository(db);
    const dynamicRules = ruleRepository
      .list()
      .filter((rule) => !rule.isSystem && rule.targetId === "room-506");
    expect(dynamicRules).toHaveLength(1);
    const stableRuleId = dynamicRules[0].id;

    const updatedRule = await sendAgentMessage(
      "只改成下午维修",
      "request-rule-update",
    );
    expect(updatedRule.status).toBe(200);
    expect(
      ruleRepository
        .list()
        .filter((rule) => !rule.isSystem && rule.targetId === "room-506"),
    ).toHaveLength(1);
    expect(ruleRepository.findById(stableRuleId)).toMatchObject({
      id: stableRuleId,
      reason: "临时维修",
      start: "2026-08-05T05:00:00.000Z",
      end: "2026-08-05T10:00:00.000Z",
      version: 2,
    });

    const history = new ConversationHistoryRepository(db).getHistory(
      "integration-conversation",
    );
    expect(history).toHaveLength(8);
    expect(JSON.stringify(history)).toContain(stableRuleId);
  });

  async function sendAgentMessage(
    message: string,
    requestId: string,
  ): Promise<{
    status: number;
    body: {
      error: unknown;
      actions: Array<Record<string, unknown>>;
    };
  }> {
    const response = await app.request("/api/agent/message", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        conversationId: "integration-conversation",
        message,
        requestId,
      }),
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  }
});

function scenarioParser(): AgentIntentParser {
  return {
    async parseIntent(request) {
      switch (request.message) {
        case "预约 506":
          return {
            intent: {
              type: "create_booking",
              roomId: "506",
              date: "2026-08-03",
              timeRange: { startTime: "10:00", endTime: "11:00" },
              title: "项目讨论",
            },
          };
        case "取消刚才的预约":
          return {
            intent: {
              type: "cancel_booking",
            },
          };
        case "506 全天维修":
          return {
            intent: {
              type: "create_unavailability_rule",
              target: "506",
              date: "2026-08-05",
              timeRange: { startTime: "00:00", endTime: "24:00" },
              reason: "临时维修",
            },
          };
        case "只改成下午维修":
          return {
            intent: {
              type: "update_last_unavailability_rule",
              timeRange: { startTime: "13:00", endTime: "18:00" },
            },
          };
        default:
          return {
            intent: {
              type: "need_clarification",
              missingFields: ["date"],
              clarification: "请补充日期。",
            },
          };
      }
    },
  };
}
