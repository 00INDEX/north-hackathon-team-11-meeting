/**
 * Hono server entrypoint for the local meeting room system.
 *
 * RFC-0001: 本地会议室查询与预订系统
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";
import {
  createAgentMessageRoute,
  type CreateAgentMessageRouteOptions,
} from "@/api/agent.js";
import { createConversationHistoryRoutes } from "@/api/history.js";
import { APP_TIMEZONE, DEFAULT_OPEN_HOURS } from "@/config/app";
import { validateStartupEnvironment } from "@/config/startupEnv.js";
import { openDatabase, type Database } from "@/db";
import { ensureDatabaseReady } from "@/db/ensure";
import { appErrorHandler } from "@/errors/hono";
import { ConversationHistoryRepository } from "@/persistence/sqlite/ConversationHistoryRepository";
import { createAvailabilityRoutes } from "@/server/routes/availabilityRoutes";
import { createAuditRoutes } from "@/server/routes/auditRoutes";
import { createReservationRoutes } from "@/server/routes/reservationRoutes";
import { createRoomRoutes } from "@/server/routes/roomRoutes";
import { createRuleRoutes } from "@/server/routes/ruleRoutes";
import { renderMeetingRoomApp } from "@/ui/meetingRoomUi";

export interface CreateAppOptions {
  agent?: Omit<CreateAgentMessageRouteOptions, "history">;
}

export function createApp(db: Database, options: CreateAppOptions = {}): Hono {
  const app = new Hono();
  const conversationHistory = new ConversationHistoryRepository(db);

  app.use("*", logger());
  app.onError(appErrorHandler);

  app.get("/health", (c) => {
    return c.json({
      status: "ok",
      timezone: APP_TIMEZONE,
      defaultOpenHours: DEFAULT_OPEN_HOURS,
    });
  });

  app.get("/", (c) => {
    return c.html(renderMeetingRoomApp());
  });

  app.route("/api/rooms", createRoomRoutes(db));
  app.route("/api/rules", createRuleRoutes(db));
  app.route("/api", createAvailabilityRoutes(db));
  app.route("/api/reservations", createReservationRoutes(db));
  app.route("/api/audit-events", createAuditRoutes(db));
  app.route(
    "/",
    createConversationHistoryRoutes({
      history: conversationHistory,
    }),
  );
  app.route(
    "/",
    createAgentMessageRoute({
      ...options.agent,
      history: conversationHistory,
    }),
  );

  return app;
}

if (process.env.NODE_ENV !== "test") {
  validateStartupEnvironment();
}

export const app = createApp(openDatabase());

export async function startServer(port = Number(process.env.PORT ?? 3000)) {
  validateStartupEnvironment();
  ensureDatabaseReady();

  await new Promise<void>((resolve) => {
    serve(
      {
        fetch: app.fetch,
        port,
      },
      () => {
        console.log(
          `Meeting room system listening on http://localhost:${port}`,
        );
        resolve();
      },
    );
  });
}

if (process.env.NODE_ENV !== "test") {
  void startServer();
}
