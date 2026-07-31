/**
 * Room management API routes for RFC-0001 T2.
 *
 * RFC-0001: 本地会议室查询与预订系统
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Database } from "@/db";
import type { AuditContext } from "@/domain/audit/AuditService";
import { AvailabilityService } from "@/domain/availability";
import { RoomService } from "@/domain/room/RoomService";
import type {
  CreateCombinedRoomInput,
  CreateRoomInput,
  UpdateRoomInput,
} from "@/domain/room/types";

export function createRoomRoutes(db: Database) {
  const app = new Hono();
  const service = new RoomService(db);
  const availabilityService = new AvailabilityService(db);

  app.get("/", (c) => c.json(service.listWithResources()));

  app.post("/combined", async (c) => {
    const body = (await c.req.json()) as CreateCombinedRoomInput;
    return c.json(service.createCombined(body, auditContext(c)), 201);
  });

  app.get("/:roomId", (c) => {
    const room = service.findById(c.req.param("roomId"));
    if (!room) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `房间不存在: ${c.req.param("roomId")}`,
          },
        },
        404,
      );
    }
    return c.json(room);
  });

  app.post("/", async (c) => {
    const body = (await c.req.json()) as CreateRoomInput;
    return c.json(service.create(body, auditContext(c)), 201);
  });

  app.patch("/:roomId", async (c) => {
    const patch = (await c.req.json()) as UpdateRoomInput;
    return c.json(
      service.update(c.req.param("roomId"), patch, auditContext(c)),
    );
  });

  app.get("/:roomId/calendar", (c) => {
    const from = c.req.query("from");
    const to = c.req.query("to");
    if (!from || !to) {
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "日历查询必须包含 from 和 to",
          },
        },
        400,
      );
    }
    return c.json(
      availabilityService.getRoomCalendar(c.req.param("roomId"), from, to),
    );
  });

  return app;
}

function auditContext(c: Context): AuditContext {
  return {
    actor: c.req.header("x-actor") ?? "local-user",
    reason: c.req.header("x-reason") ?? "",
    idempotencyKey: c.req.header("x-idempotency-key") ?? null,
  };
}
