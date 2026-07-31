/**
 * Availability rule management service for RFC-0001 T2.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * Persists periodic and dynamic blocking rules, enforces interval/version checks, and records audit events.
 */
import { randomUUID } from "node:crypto";
import { AppError } from "@/errors/AppError";
import { AuditService } from "@/domain/audit/AuditService";
import { AuditEventRepository } from "@/persistence/sqlite/AuditEventRepository";
import { AvailabilityRuleRepository } from "@/persistence/sqlite/AvailabilityRuleRepository";
import { ResourceRepository } from "@/persistence/sqlite/ResourceRepository";
import { RoomRepository } from "@/persistence/sqlite/RoomRepository";
import type { Database } from "@/db";
import type { AuditContext } from "@/domain/audit/AuditService";
import { parseUtc } from "@/time";
import type {
  AvailabilityRule,
  CreateAvailabilityRuleInput,
  UpdateAvailabilityRuleInput,
} from "./types";

export class RuleService {
  private readonly auditService: AuditService;

  constructor(
    private readonly db: Database,
    private readonly repository = new AvailabilityRuleRepository(db),
    auditRepository = new AuditEventRepository(db),
  ) {
    this.auditService = new AuditService(auditRepository);
  }

  list(): AvailabilityRule[] {
    return this.repository.list();
  }

  findRoom(id: string): { id: string; name: string } | undefined {
    return new RoomRepository(this.db).findById(id);
  }

  findResource(id: string): { id: string; name: string } | undefined {
    return new ResourceRepository(this.db).findById(id);
  }

  findById(id: string): AvailabilityRule | undefined {
    return this.repository.findById(id);
  }

  create(
    input: CreateAvailabilityRuleInput,
    context: AuditContext = {},
  ): AvailabilityRule {
    const candidate: AvailabilityRule = {
      ...input,
      enabled: input.enabled ?? true,
      isSystem: input.isSystem ?? false,
      version: input.version ?? 1,
      createdAt: input.createdAt ?? new Date().toISOString(),
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    validateRuleInput(candidate, this);
    if (this.repository.findById(input.id)) {
      throw new AppError("VALIDATION_ERROR", `规则已存在: ${input.id}`);
    }
    const rule = this.repository.upsert(candidate);
    this.auditService.record(
      {
        id: `audit-${randomUUID()}`,
        eventType: "rule.created",
        targetType: "rule",
        targetId: rule.id,
        before: undefined,
        after: toAuditRule(rule),
      },
      context,
    );
    return rule;
  }

  update(
    id: string,
    patch: UpdateAvailabilityRuleInput,
    context: AuditContext = {},
  ): AvailabilityRule {
    const existing = this.repository.findById(id);
    if (!existing) {
      throw new AppError("NOT_FOUND", `规则不存在: ${id}`, {
        conflicts: [{ type: "rule", id, name: id }],
      });
    }

    if (patch.version !== undefined && patch.version !== existing.version) {
      throw new AppError("VERSION_CONFLICT", `规则版本已过期: ${id}`, {
        conflicts: [
          {
            type: "version",
            id,
            name: existing.reason,
            reason: `当前版本为 ${existing.version}`,
          },
        ],
      });
    }

    const next = {
      ...existing,
      ...patch,
      version: existing.version + 1,
    };
    validateRuleInput(next, this);

    const updated = this.repository.upsert({
      ...next,
      createdAt: existing.createdAt,
    });
    this.auditService.record(
      {
        id: `audit-${randomUUID()}`,
        eventType: "rule.updated",
        targetType: "rule",
        targetId: updated.id,
        before: toAuditRule(existing),
        after: toAuditRule(updated),
      },
      context,
    );
    return updated;
  }

  delete(id: string, context: AuditContext = {}): AvailabilityRule {
    const existing = this.repository.findById(id);
    if (!existing) {
      throw new AppError("NOT_FOUND", `规则不存在: ${id}`, {
        conflicts: [{ type: "rule", id, name: id }],
      });
    }
    if (existing.isSystem) {
      throw new AppError(
        "VALIDATION_ERROR",
        "业务基线规则不可删除，只能调整范围或停用动态规则",
      );
    }

    const updated = this.repository.upsert({
      ...existing,
      enabled: false,
      version: existing.version + 1,
    });
    this.auditService.record(
      {
        id: `audit-${randomUUID()}`,
        eventType: "rule.deleted",
        targetType: "rule",
        targetId: updated.id,
        before: toAuditRule(existing),
        after: toAuditRule(updated),
      },
      context,
    );
    return updated;
  }

  updateSystemRule(
    id: string,
    patch: UpdateAvailabilityRuleInput,
    context: AuditContext = {},
  ): AvailabilityRule {
    const existing = this.repository.findById(id);
    if (!existing) {
      throw new AppError("NOT_FOUND", `规则不存在: ${id}`, {
        conflicts: [{ type: "rule", id, name: id }],
      });
    }
    if (!existing.isSystem) {
      throw new AppError("VALIDATION_ERROR", "仅业务基线规则支持受控配置调整");
    }

    if (patch.version !== undefined && patch.version !== existing.version) {
      throw new AppError("VERSION_CONFLICT", `规则版本已过期: ${id}`, {
        conflicts: [
          {
            type: "version",
            id,
            name: existing.reason,
            reason: `当前版本为 ${existing.version}`,
          },
        ],
      });
    }

    const next = {
      ...existing,
      ...patch,
      version: existing.version + 1,
    };
    validateRuleInput(next, this);

    const updated = this.repository.upsert({
      ...next,
      createdAt: existing.createdAt,
      isSystem: true,
    });
    this.auditService.record(
      {
        id: `audit-${randomUUID()}`,
        eventType: "rule.updated",
        targetType: "rule",
        targetId: updated.id,
        before: toAuditRule(existing),
        after: toAuditRule(updated),
      },
      context,
    );
    return updated;
  }
}

function validateRuleInput(rule: AvailabilityRule, service: RuleService): void {
  if (!rule.id || !rule.reason.trim()) {
    throw new AppError("VALIDATION_ERROR", "规则 ID 和原因不能为空");
  }
  if (!["room", "resource"].includes(rule.targetType)) {
    throw new AppError(
      "VALIDATION_ERROR",
      `不支持的规则目标类型: ${rule.targetType}`,
    );
  }
  if (
    !["open_hours", "periodic_block", "one_time_block"].includes(rule.ruleType)
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      `不支持的规则类型: ${rule.ruleType}`,
    );
  }
  validateUtcInterval(rule.start, rule.end);
  validateTarget(rule.targetType, rule.targetId, service);
  if (rule.ruleType === "periodic_block") {
    validatePeriodicRecurrence(rule.recurrence);
  }
}

function validateUtcInterval(start: string, end: string): void {
  const startDate = parseUtcSafe(start);
  const endDate = parseUtcSafe(end);
  if (!startDate || !endDate) {
    throw new AppError(
      "VALIDATION_ERROR",
      "规则起止时间必须是合法 UTC ISO 时间",
    );
  }

  if (startDate.getTime() >= endDate.getTime()) {
    throw new AppError(
      "VALIDATION_ERROR",
      `规则起止时间必须满足 start < end: ${start}–${end}`,
    );
  }
}

function parseUtcSafe(value: string): Date | undefined {
  try {
    return parseUtc(value);
  } catch {
    return undefined;
  }
}

function validatePeriodicRecurrence(recurrence?: string): void {
  if (!recurrence) {
    throw new AppError("VALIDATION_ERROR", "周期规则必须包含 recurrence");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(recurrence);
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "周期规则 recurrence 必须是合法 JSON",
    );
  }

  if (
    !isObject(parsed) ||
    parsed.type !== "weekly" ||
    !Array.isArray(parsed.weekdays)
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "周期规则 recurrence 必须包含 weekly.weekdays",
    );
  }
  if (
    !parsed.weekdays.every(
      (weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6,
    )
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "周期规则 weekday 必须是 0-6 的整数",
    );
  }
  if (
    typeof parsed.timeStart !== "string" ||
    typeof parsed.timeEnd !== "string"
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "周期规则 recurrence 必须包含 timeStart 和 timeEnd",
    );
  }
  validateRuleClockRange(parsed.timeStart, parsed.timeEnd);
}

function validateRuleClockRange(start: string, end: string): void {
  const startTime = parseRuleClock(start);
  const endTime = parseRuleClock(end);
  if (start !== "24:00" && end === "24:00") {
    return;
  }
  if (startTime >= endTime) {
    throw new AppError(
      "VALIDATION_ERROR",
      `周期规则时间必须满足 start < end: ${start}–${end}`,
    );
  }
}

function parseRuleClock(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new AppError("VALIDATION_ERROR", "规则时间格式必须为 HH:mm");
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    hour < 0 ||
    hour > 24 ||
    minute < 0 ||
    minute > 59 ||
    (hour === 24 && minute !== 0)
  ) {
    throw new AppError("VALIDATION_ERROR", "规则时间必须位于 00:00–24:00");
  }
  return hour * 60 + minute;
}

function validateTarget(
  targetType: string,
  targetId: string,
  service: RuleService,
): void {
  const found =
    targetType === "room"
      ? service.findRoom(targetId)
      : service.findResource(targetId);
  if (!found) {
    throw new AppError(
      "NOT_FOUND",
      `规则目标不存在: ${targetType}:${targetId}`,
    );
  }
}

function toAuditRule(rule: AvailabilityRule): Record<string, unknown> {
  return {
    id: rule.id,
    targetType: rule.targetType,
    targetId: rule.targetId,
    ruleType: rule.ruleType,
    reason: rule.reason,
    enabled: rule.enabled,
    isSystem: rule.isSystem,
    recurrence: rule.recurrence,
    start: rule.start,
    end: rule.end,
    version: rule.version,
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
