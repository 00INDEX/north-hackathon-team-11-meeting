/**
 * Availability rule API routes for RFC-0001 T2.
 *
 * RFC-0001: 本地会议室查询与预订系统
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { Database } from "@/db";
import type { AuditContext } from "@/domain/audit/AuditService";
import { RuleService } from "@/domain/rule/RuleService";
import type {
  CreateAvailabilityRuleInput,
  UpdateAvailabilityRuleInput,
} from "@/domain/rule/types";

export function createRuleRoutes(db: Database) {
  const app = new Hono();
  const service = new RuleService(db);

  app.get("/", (c) => c.json(service.list()));

  app.get("/:ruleId", (c) => {
    const rule = service.findById(c.req.param("ruleId"));
    if (!rule) {
      return c.json(
        {
          error: {
            code: "NOT_FOUND",
            message: `规则不存在: ${c.req.param("ruleId")}`,
          },
        },
        404,
      );
    }
    return c.json(rule);
  });

  app.post("/", async (c) => {
    const body = (await c.req.json()) as Partial<CreateAvailabilityRuleInput>;
    const rule = service.create(
      {
        ...body,
        id: body.id ?? `rule-${Date.now()}`,
      } as CreateAvailabilityRuleInput,
      auditContext(c),
    );
    return c.json(rule, 201);
  });

  app.patch("/:ruleId", async (c) => {
    const patch = (await c.req.json()) as UpdateAvailabilityRuleInput;
    const rule = service.findById(c.req.param("ruleId"));
    if (rule?.isSystem) {
      return c.json(
        service.updateSystemRule(c.req.param("ruleId"), patch, auditContext(c)),
      );
    }
    return c.json(
      service.update(c.req.param("ruleId"), patch, auditContext(c)),
    );
  });

  app.delete("/:ruleId", (c) =>
    c.json(service.delete(c.req.param("ruleId"), auditContext(c))),
  );

  return app;
}

function auditContext(c: Context): AuditContext {
  return {
    actor: c.req.header("x-actor") ?? "local-user",
    reason: c.req.header("x-reason") ?? "",
    idempotencyKey: c.req.header("x-idempotency-key") ?? null,
  };
}
