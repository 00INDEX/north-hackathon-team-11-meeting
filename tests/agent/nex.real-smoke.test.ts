import assert from "node:assert/strict";
import test from "node:test";
import { createNexLLMClient } from "../../src/agent/nex.js";

const runRealSmoke = process.env.RUN_REAL_NEX_SMOKE === "true";

test(
  "opt-in real Nex parser smoke does not execute business mutations",
  {
    skip: runRealSmoke
      ? false
      : "Set RUN_REAL_NEX_SMOKE=true to call the real Nex parser.",
    timeout: 30_000,
  },
  async () => {
    assert.ok(
      process.env.NEX_API_KEY,
      "NEX_API_KEY is required when RUN_REAL_NEX_SMOKE=true.",
    );

    const parser = createNexLLMClient({
      maxRetries: 1,
      timeoutMs: 15_000,
      now: () => new Date("2026-07-31T04:00:00.000Z"),
      timeZone: "Asia/Shanghai",
    });
    const result = await parser.parseIntent({
      userId: "local-user",
      conversationId: "real-nex-smoke-read-only",
      message: "当前日期 2026-07-31，明天上午预约 506",
      history: [],
    });

    assert.equal(result.error, undefined);
    assert.equal(result.intent?.type, "create_booking");
    if (result.intent?.type === "create_booking") {
      assert.equal(result.intent.roomId.replace(/^room-/, ""), "506");
      assert.equal(result.intent.date, "2026-08-01");
      assert.deepEqual(result.intent.timeRange, {
        startTime: "09:00",
        endTime: "12:00",
      });
    }
  },
);
