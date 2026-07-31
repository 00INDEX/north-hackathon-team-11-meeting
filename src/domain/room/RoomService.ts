/**
 * Room configuration service for RFC-0001 T2.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * Coordinates room reads, open-hour updates, optimistic version checks, and audit writes.
 */
import { randomUUID } from "node:crypto";
import type { Database } from "@/db";
import { AppError } from "@/errors/AppError";
import { AuditService } from "@/domain/audit/AuditService";
import { AuditEventRepository } from "@/persistence/sqlite/AuditEventRepository";
import { RoomRepository } from "@/persistence/sqlite/RoomRepository";
import { parseLocalTime } from "@/time";
import type { AuditContext } from "@/domain/audit/AuditService";
import type { CreateRoomInput, Room, UpdateRoomInput } from "./types";

export class RoomService {
  private readonly auditService: AuditService;

  constructor(
    private readonly db: Database,
    private readonly repository = new RoomRepository(db),
    auditRepository = new AuditEventRepository(db),
  ) {
    this.auditService = new AuditService(auditRepository);
  }

  list(): Room[] {
    return this.repository.list();
  }

  listWithResources() {
    return this.repository.listWithResources();
  }

  findById(id: string): Room | undefined {
    return this.repository.findById(id);
  }

  create(input: CreateRoomInput, context: AuditContext = {}): Room {
    validateRoomInput(input);
    if (this.repository.findById(input.id)) {
      throw new AppError("VALIDATION_ERROR", `房间已存在: ${input.id}`);
    }
    const room = this.repository.upsert({
      ...input,
      version: input.version ?? 1,
    });
    this.auditService.record(
      {
        id: `audit-${randomUUID()}`,
        eventType: "room.created",
        targetType: "room",
        targetId: room.id,
        before: undefined,
        after: toAuditRoom(room),
      },
      context,
    );
    return room;
  }

  update(id: string, patch: UpdateRoomInput, context: AuditContext = {}): Room {
    const existing = this.repository.findById(id);
    if (!existing) {
      throw new AppError("NOT_FOUND", `房间不存在: ${id}`, {
        conflicts: [{ type: "room", id, name: id }],
      });
    }

    if (patch.version !== undefined && patch.version !== existing.version) {
      throw new AppError("VERSION_CONFLICT", `房间版本已过期: ${id}`, {
        conflicts: [
          {
            type: "version",
            id,
            name: existing.name,
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
    validateRoomInput(next);

    const updated = this.repository.upsert({
      ...next,
      createdAt: existing.createdAt,
    });
    this.auditService.record(
      {
        id: `audit-${randomUUID()}`,
        eventType: "room.updated",
        targetType: "room",
        targetId: updated.id,
        before: toAuditRoom(existing),
        after: toAuditRoom(updated),
      },
      context,
    );
    return updated;
  }
}

function validateRoomInput(input: CreateRoomInput | Room): void {
  if (!input.id || !input.name || !input.type || !input.location) {
    throw new AppError("VALIDATION_ERROR", "房间基础字段不能为空");
  }
  if (!Number.isInteger(input.capacity) || input.capacity <= 0) {
    throw new AppError("VALIDATION_ERROR", "房间容量必须为正整数");
  }
  if (!Array.isArray(input.equipment)) {
    throw new AppError("VALIDATION_ERROR", "房间设备必须是字符串数组");
  }
  validateLocalTimeRange(input.openStart ?? "08:00", input.openEnd ?? "22:00");
}

function validateLocalTimeRange(start: string, end: string): void {
  try {
    parseLocalTime(start);
    parseLocalTime(end);
  } catch {
    throw new AppError("VALIDATION_ERROR", "房间开放时段格式必须为 HH:mm");
  }

  if (start >= end) {
    throw new AppError(
      "VALIDATION_ERROR",
      `房间开放时段必须满足 start < end: ${start}–${end}`,
    );
  }
}

function toAuditRoom(room: Room): Record<string, unknown> {
  return {
    id: room.id,
    name: room.name,
    type: room.type,
    capacity: room.capacity,
    location: room.location,
    equipment: room.equipment,
    enabled: room.enabled,
    openStart: room.openStart,
    openEnd: room.openEnd,
    version: room.version,
  };
}
