/**
 * Shared interval primitives for RFC-0001 T3.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * All reservation, rule, and availability windows use half-open UTC intervals [start, end).
 */
import { AppError } from '@/errors/AppError';
import { combineLocalDateTime, parseUtc } from '@/time';

export interface UtcInterval {
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
}

export function parseUtcInterval(start: string, end: string): UtcInterval {
  const startDate = parseUtcDate(start, '请求开始时间必须是合法 UTC ISO 时间');
  const endDate = parseUtcDate(end, '请求结束时间必须是合法 UTC ISO 时间');
  if (startDate.getTime() >= endDate.getTime()) {
    throw new AppError('VALIDATION_ERROR', `请求起止时间必须满足 start < end: ${start}–${end}`);
  }

  return {
    start: startDate,
    end: endDate,
    startIso: startDate.toISOString(),
    endIso: endDate.toISOString(),
  };
}

export function intervalsOverlap(left: UtcInterval, right: UtcInterval): boolean {
  return left.start.getTime() < right.end.getTime() && right.start.getTime() < left.end.getTime();
}

export function clipInterval(interval: UtcInterval, bounds: UtcInterval): UtcInterval | undefined {
  if (!intervalsOverlap(interval, bounds)) {
    return undefined;
  }

  const start = new Date(Math.max(interval.start.getTime(), bounds.start.getTime()));
  const end = new Date(Math.min(interval.end.getTime(), bounds.end.getTime()));
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function parseClockMinutes(value: string, allowMidnightEnd = false): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new AppError('VALIDATION_ERROR', '时间格式必须为 HH:mm');
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 24 || minute < 0 || minute > 59 || (hour === 24 && (!allowMidnightEnd || minute !== 0))) {
    throw new AppError('VALIDATION_ERROR', '时间必须位于 00:00–24:00');
  }
  return hour * 60 + minute;
}

function parseUtcDate(value: string, message: string): Date {
  try {
    return parseUtc(value);
  } catch {
    throw new AppError('VALIDATION_ERROR', message);
  }
}

export function toLocalDateKey(value: string | Date): string {
  const date = typeof value === 'string' ? parseUtc(value) : value;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const valueFor = (name: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === name)?.value ?? 0);

  return `${valueFor('year')}-${String(valueFor('month')).padStart(2, '0')}-${String(valueFor('day')).padStart(2, '0')}`;
}

export function addLocalDateDays(dateKey: string, days: number): string {
  const localMidnight = localDateStartUtc(dateKey).getTime();
  const shifted = new Date(localMidnight + days * 24 * 60 * 60 * 1000);
  return toLocalDateKey(shifted);
}

export function localDateStartUtc(dateKey: string): Date {
  return parseUtc(combineLocalDateTime(dateKey, '00:00'));
}

export function localTimeToUtc(dateKey: string, time: string): Date {
  if (time === '24:00') {
    return localDateStartUtc(addLocalDateDays(dateKey, 1));
  }
  return parseUtc(combineLocalDateTime(dateKey, time));
}
