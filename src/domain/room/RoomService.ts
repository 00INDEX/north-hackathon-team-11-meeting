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
import type {
  CreateCombinedRoomInput,
  CreateRoomInput,
  Room,
  UpdateRoomInput,
} from "./types";
import type { RoomWithResources } from "@/persistence/sqlite/RoomRepository";

export class RoomService {
  private readonly auditService: AuditService;

  constructor(
    private readonly db: Database,
    private readonly repository = new RoomRepository(db),
    private readonly auditRepository = new AuditEventRepository(db),
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
    const replay = this.replayedRoom("room.created", input.id, context);
    if (replay) {
      return replay;
    }
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

  createCombined(
    input: CreateCombinedRoomInput,
    context: AuditContext = {},
  ): RoomWithResources {
    const componentRoomIds = [...new Set(input.componentRoomIds ?? [])];
    if (!input.id?.trim()) {
      throw new AppError("VALIDATION_ERROR", "组合会议室 ID 不能为空");
    }
    if (componentRoomIds.length < 2) {
      throw new AppError(
        "VALIDATION_ERROR",
        "组合会议室至少需要两个不同的组件房间",
      );
    }
    if (componentRoomIds.includes(input.id)) {
      throw new AppError("VALIDATION_ERROR", "组合会议室不能包含自身作为组件");
    }

    const replay = this.replayedRoom("room.created", input.id.trim(), context);
    if (replay) {
      return this.repository
        .listWithResources()
        .find((room) => room.id === replay.id) as RoomWithResources;
    }

    const roomsById = new Map(
      this.repository.listWithResources().map((room) => [room.id, room]),
    );
    const components = componentRoomIds.map((roomId) => {
      const room = roomsById.get(roomId);
      if (!room) {
        throw new AppError("NOT_FOUND", `组件房间不存在: ${roomId}`, {
          conflicts: [{ type: "room", id: roomId, name: roomId }],
        });
      }
      if (room.resources.length === 0) {
        throw new AppError(
          "VALIDATION_ERROR",
          `组件房间没有可组合的物理资源: ${roomId}`,
        );
      }
      return room;
    });

    const resourceIds = [
      ...new Set(
        components.flatMap((room) =>
          room.resources.map((resource) => resource.id),
        ),
      ),
    ];
    const openStart = components
      .map((room) => room.openStart)
      .sort()
      .at(-1) as string;
    const openEnd = components
      .map((room) => room.openEnd)
      .sort()
      .at(0) as string;
    validateLocalTimeRange(openStart, openEnd);

    return this.db.transaction(() => {
      const created = this.create(
        {
          id: input.id.trim(),
          name:
            input.name?.trim() ||
            components.map((room) => room.name).join(" + "),
          type: "组合会议室",
          capacity:
            input.capacity ??
            components.reduce((sum, room) => sum + room.capacity, 0),
          location:
            input.location?.trim() ||
            [...new Set(components.map((room) => room.location))].join(" / "),
          equipment: input.equipment ?? [
            ...new Set(components.flatMap((room) => room.equipment)),
          ],
          enabled: components.every((room) => room.enabled),
          openStart,
          openEnd,
        },
        context,
      );
      this.repository.replaceRoomResources(created.id, resourceIds);

      return this.repository
        .listWithResources()
        .find((room) => room.id === created.id) as RoomWithResources;
    })();
  }

  update(id: string, patch: UpdateRoomInput, context: AuditContext = {}): Room {
    const replay = this.replayedRoom("room.updated", id, context);
    if (replay) {
      return replay;
    }
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

  private replayedRoom(
    eventType: "room.created" | "room.updated",
    targetId: string,
    context: AuditContext,
  ): Room | undefined {
    if (!context.idempotencyKey) {
      return undefined;
    }
    const prior = this.auditRepository.findByIdempotencyKey(
      context.idempotencyKey,
    );
    if (!prior) {
      return undefined;
    }
    if (prior.eventType !== eventType || prior.targetId !== targetId) {
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        `幂等键已用于其他房间操作: ${context.idempotencyKey}`,
      );
    }
    const room = this.repository.findById(prior.targetId);
    if (!room) {
      throw new AppError("INTERNAL_ERROR", "幂等房间操作的目标记录不存在");
    }
    return room;
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
