/**
 * Natural-language response formatter for the meeting-room Agent.
 *
 * RFC-0002: Meeting Room Agent Orchestrator
 *
 * This module translates structured orchestrator and parser results into the
 * user-visible reply returned by the Agent API. It keeps backend decisions as the
 * source of truth while making follow-up questions, conflicts, permission issues,
 * parse failures, and backend availability failures understandable to users.
 */

import type {
  AgentAction,
  AgentError,
  AgentIntent,
  AvailabilityFilters,
} from './types.js';
import type {
  AvailabilityCheckResult,
  Booking,
  BookingResult,
  ConflictDetail,
  OrchestratorResult,
  Room,
  UnavailabilityRule,
  UnavailabilityRuleResult,
} from './businessApi.js';

export interface AgentMessageResponse {
  reply: string;
  parsedIntent: AgentIntent | null;
  actions: AgentAction[];
  error: AgentError | null;
}

export interface FormatAgentMessageOptions {
  intent?: AgentIntent | null;
  parserError?: AgentError | null;
  orchestratorResult?: OrchestratorResult | null;
}

export interface FormatAgentMessageResult {
  reply: string;
  parsedIntent: AgentIntent | null;
  actions: AgentAction[];
  error: AgentError | null;
}

/**
 * Format parser and orchestrator outputs into the RFC-0002 Agent API response.
 *
 * RFC-0002: The reply is the only user-facing natural-language channel; parsedIntent,
 * actions, and error preserve machine-readable traceability for clients and tests.
 */
export function formatAgentMessage(options: FormatAgentMessageOptions): FormatAgentMessageResult {
  if (options.parserError) {
    return {
      reply: formatErrorReply(options.parserError),
      parsedIntent: null,
      actions: [],
      error: options.parserError,
    };
  }

  if (!options.intent) {
    return {
      reply: '抱歉，我暂时没有理解你的请求。请把要查询、预约、取消或修改的内容说得再具体一些。',
      parsedIntent: null,
      actions: [],
      error: null,
    };
  }

  const orchestratorResult = options.orchestratorResult;
  if (orchestratorResult?.error) {
    return {
      reply: formatErrorReply(orchestratorResult.error),
      parsedIntent: options.intent,
      actions: orchestratorResult.actions,
      error: orchestratorResult.error,
    };
  }

  if (options.intent.type === 'need_clarification') {
    return {
      reply: options.intent.clarification,
      parsedIntent: options.intent,
      actions: orchestratorResult?.actions ?? [],
      error: null,
    };
  }

  if (!orchestratorResult) {
    return {
      reply: formatActionAcceptedReply(options.intent),
      parsedIntent: options.intent,
      actions: [],
      error: null,
    };
  }

  return {
    reply: formatOrchestratorSuccessReply(options.intent, orchestratorResult.data, orchestratorResult.actions),
    parsedIntent: options.intent,
    actions: orchestratorResult.actions,
    error: null,
  };
}

function formatActionAcceptedReply(intent: AgentIntent): string {
  switch (intent.type) {
    case 'query_available_rooms':
      return `好的，我将查询 ${formatDate(intent.date)} ${formatTimeRange(intent.timeRange)} 的可用会议室。`;
    case 'create_booking':
      return `好的，我将帮你预约 ${formatRoomNameFromIntent(intent.roomId)}，时间是 ${formatDate(intent.date)} ${formatTimeRange(intent.timeRange)}。`;
    case 'cancel_booking':
      return intent.bookingId ? `好的，我将取消预约 ${intent.bookingId}。` : '好的，我将尝试取消符合条件的预约。';
    case 'create_unavailability_rule':
      return `好的，我将为 ${formatTargetName(intent.target)} 创建不可预约规则。`;
    case 'update_last_unavailability_rule':
      return '好的，我将更新上一条不可预约规则。';
    case 'create_or_update_room':
      return `好的，我将保存会议室 ${formatRoomNameFromIntent(intent.roomId)} 的配置。`;
    case 'create_combined_room':
      return `好的，我将创建组合会议室 ${intent.combinedRoomId}。`;
    case 'need_clarification':
      return intent.clarification;
    default:
      return assertNever(intent);
  }
}

function formatOrchestratorSuccessReply(intent: AgentIntent, data: unknown, actions: AgentAction[]): string {
  switch (intent.type) {
    case 'query_available_rooms':
      return formatAvailabilityReply(data as AvailabilityCheckResult, intent.date, intent.timeRange, intent.filters);
    case 'create_booking':
      return formatBookingResultReply(data as BookingResult, '预约');
    case 'cancel_booking':
      return formatBookingResultReply(data as BookingResult, '取消');
    case 'create_unavailability_rule':
      return formatUnavailabilityRuleReply(data as UnavailabilityRuleResult, actions, '创建');
    case 'update_last_unavailability_rule':
      return formatUnavailabilityRuleReply(data as UnavailabilityRuleResult, actions, '更新');
    case 'create_or_update_room':
      return formatRoomResultReply(data, '已保存');
    case 'create_combined_room':
      return formatCombinedRoomReply(data, intent);
    case 'need_clarification':
      return intent.clarification;
    default:
      return assertNever(intent);
  }
}

function formatAvailabilityReply(result: AvailabilityCheckResult, date: string, timeRange: { startTime: string; endTime: string }, filters?: AvailabilityFilters): string {
  const rooms = Array.isArray(result?.availableRooms) ? result.availableRooms : [];
  const conflicts = Array.isArray(result?.conflicts) ? result.conflicts : [];
  const filterText = formatFilters(filters);
  const scopeText = `${formatDate(date)} ${formatTimeRange(timeRange)}${filterText ? `，${filterText}` : ''}`;

  if (rooms.length === 0) {
    const conflictText = conflicts.length > 0 ? formatConflictSummary(conflicts) : '这个时间段没有可用会议室。';
    return `${scopeText}没有可用会议室。${conflictText}`;
  }

  const roomList = rooms.map((room) => formatRoom(room)).join('；');
  return `${scopeText}可用会议室：${roomList}。`;
}

function formatBookingResultReply(result: BookingResult, actionLabel: '预约' | '取消'): string {
  if (result.conflict) {
    return `${actionLabel}失败：${formatConflictSummary([result.conflict])}`;
  }

  const booking = result.booking;
  if (!booking) {
    return actionLabel === '预约'
      ? '预约已提交，后端没有返回预约详情。'
      : '预约已取消，后端没有返回预约详情。';
  }

  if (booking.status === 'cancelled') {
    return `已取消预约：${formatBooking(booking)}。`;
  }

  return `预约成功：${formatBooking(booking)}。`;
}

function formatUnavailabilityRuleReply(result: UnavailabilityRuleResult, actions: AgentAction[], actionLabel: '创建' | '更新'): string {
  const action = actions[0];
  const target = action?.payload && isRecord(action.payload) && typeof action.payload.target === 'string'
    ? action.payload.target
    : result.rule?.target;
  const rule = result.rule;

  if (!rule && !result.updatedRuleId) {
    return `${actionLabel}不可预约规则失败：后端没有返回规则详情。`;
  }

  if (result.updatedRuleId) {
    return `${actionLabel}不可预约规则成功，已更新规则 ${result.updatedRuleId}。${rule ? formatRuleScope(rule, target) : ''}`;
  }

  return `${actionLabel}不可预约规则成功。${rule ? formatRuleScope(rule, target) : ''}`;
}

function formatRoomResultReply(data: unknown, actionLabel: string): string {
  const room = isRoom(data) ? data : undefined;
  if (!room) {
    return `${actionLabel}会议室配置，但后端没有返回会议室详情。`;
  }

  return `${actionLabel}会议室配置成功：${formatRoom(room)}。`;
}

function formatCombinedRoomReply(data: unknown, intent: Extract<AgentIntent, { type: 'create_combined_room' }>): string {
  const room = isRoom(data) ? data : undefined;
  const componentText = intent.componentRoomIds.join('、');

  if (room) {
    return `组合会议室创建成功：${formatRoom(room)}，组件房间：${componentText}。`;
  }

  return `组合会议室 ${intent.combinedRoomId} 创建成功，组件房间：${componentText}。`;
}

function formatErrorReply(error: AgentError): string {
  switch (error.type) {
    case 'need_clarification':
      return error.message;
    case 'permission_denied':
      return '抱歉，当前账号没有权限执行这个操作。你可以联系管理员确认权限后重试。';
    case 'conflict':
      return formatConflictErrorReply(error);
    case 'not_found':
      return `抱歉，没有找到相关目标：${error.message}`;
    case 'backend_unavailable':
      return '抱歉，服务暂时不可用，请稍后重试。';
    case 'parse_failed':
      return `抱歉，我暂时没有解析成功：${error.message}。请换一种说法重试，或提供更明确的日期、时间、房间和标题。`;
    default:
      return assertNever(error.type);
  }
}

function formatConflictErrorReply(error: AgentError): string {
  const conflicts = extractConflicts(error);
  const summary = conflicts.length > 0 ? formatConflictSummary(conflicts) : error.message;
  return `预约冲突：${summary}`;
}

function formatConflictSummary(conflicts: ConflictDetail[]): string {
  const parts = conflicts.map((conflict) => {
    const reason = conflict.reason ? `，${conflict.reason}` : '';
    const scope = conflict.start && conflict.end ? `（${formatDateTime(conflict.start)} 至 ${formatDateTime(conflict.end)}）` : '';
    return `${conflict.name || conflict.id}${scope}${reason}`;
  });

  return parts.join('；');
}

function extractConflicts(error: AgentError): ConflictDetail[] {
  const details = error.details;
  if (isRecord(details) && Array.isArray(details.conflicts)) {
    return details.conflicts.filter(isConflictDetail);
  }
  return [];
}

function formatRoom(room: Room): string {
  const capacity = room.capacity ? ` ${room.capacity} 人` : '';
  const location = room.location ? `（${room.location}）` : '';
  return `${room.name || room.id}${capacity}${location}`;
}

function formatBooking(booking: Booking): string {
  const title = booking.title ? `「${booking.title}」` : '未命名预约';
  return `${title} ${formatDate(booking.date)} ${formatTimeRange({ startTime: booking.startTime, endTime: booking.endTime })} ${formatRoomNameFromIntent(booking.roomId)}`;
}

function formatRuleScope(rule: UnavailabilityRule, fallbackTarget?: string): string {
  const target = rule.target ? formatTargetName(rule.target) : fallbackTarget ? formatTargetName(fallbackTarget) : '目标';
  const scope = rule.date
    ? `${formatDate(rule.date)} ${rule.timeRange ? formatTimeRange(rule.timeRange) : '全天'}`
    : rule.recurring
      ? `每周 ${formatDaysOfWeek(rule.recurring.daysOfWeek)} ${formatTimeRange(rule.recurring.timeRange)}`
      : '未指定时间范围';

  const reason = rule.reason ? `，原因：${rule.reason}` : '';
  return `目标：${target}，${scope}${reason}。`;
}

function formatFilters(filters?: AvailabilityFilters): string {
  if (!filters) {
    return '';
  }

  const labels: string[] = [];
  if (filters.roomType) {
    labels.push(roomTypeLabel(filters.roomType));
  }
  if (filters.minCapacity) {
    labels.push(`至少 ${filters.minCapacity} 人`);
  }
  if (filters.equipment?.length) {
    labels.push(`设备：${filters.equipment.join('、')}`);
  }
  if (filters.combinedRoom) {
    labels.push('组合会议室');
  }
  return labels.length > 0 ? `筛选条件：${labels.join('、')}` : '';
}

function formatRoomNameFromIntent(roomId: string): string {
  return roomId.replace(/^room-/, '');
}

function formatTargetName(target: string): string {
  return target.replace(/^room-/, '');
}

function roomTypeLabel(roomType: string): string {
  const labels: Record<string, string> = {
    small: '小会议室',
    medium: '中会议室',
    large: '大会议室',
    activity: '活动室',
    combined: '组合会议室',
  };
  return labels[roomType] || roomType;
}

function formatDaysOfWeek(days: number[]): string {
  const labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days.map((day) => labels[day] ?? String(day)).join('、');
}

function formatDate(date: string): string {
  return date;
}

function formatTimeRange(timeRange: { startTime: string; endTime: string }): string {
  return `${timeRange.startTime}—${timeRange.endTime}`;
}

function formatDateTime(value: string): string {
  let normalized = value.replace('T', ' ');
  normalized = normalized.replace(/:(\d{2}):(\d{2})(?:Z|[+-]\d{2}:\d{2})?$/, ':$1');
  return normalized.replace(/(?:Z|[+-]\d{2}:\d{2})$/, '');
}

function isRoom(value: unknown): value is Room {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.capacity === 'number';
}

function isConflictDetail(value: unknown): value is ConflictDetail {
  return isRecord(value)
    && typeof value.type === 'string'
    && typeof value.id === 'string'
    && typeof value.name === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled AgentIntent or AgentError type: ${String(value)}`);
}
