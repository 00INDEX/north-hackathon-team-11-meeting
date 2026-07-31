/**
 * Timezone-aware time helpers.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * All local date and calendar boundaries are interpreted in Asia/Shanghai and persisted as UTC.
 */
import { APP_TIMEZONE } from "@/config/app";

export { APP_TIMEZONE } from "@/config/app";

export const SHANGHAI_TIMEZONE = APP_TIMEZONE;

export interface DateParts {
  year: number;
  month: number;
  day: number;
}

export interface TimeParts {
  hour: number;
  minute: number;
}

interface DateTimeParts extends DateParts, TimeParts {
  second: number;
}

export function nowUtc(): string {
  return new Date().toISOString();
}

export function toUtcISOString(date: Date): string {
  return date.toISOString();
}

export function parseUtc(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid UTC timestamp: ${value}`);
  }
  return date;
}

export function parseLocalDate(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid local date: ${value}`);
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

export function parseLocalTime(value: string): TimeParts {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(`Invalid local time: ${value}`);
  }

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid local time: ${value}`);
  }

  return { hour, minute };
}

export function combineLocalDateTime(date: string, time: string): string {
  const parts = {
    ...parseLocalDate(date),
    ...parseLocalTime(time),
    second: 0,
  };
  return localDateTimeToUtcISOString(parts);
}

function localDateTimeToUtcISOString(parts: DateTimeParts): string {
  const localWallClock = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0,
  );
  for (
    let offsetMinutes = -16 * 60;
    offsetMinutes <= 16 * 60;
    offsetMinutes += 60
  ) {
    const candidate = localWallClock - offsetMinutes * 60_000;
    if (matchesShanghaiParts(candidate, parts)) {
      return new Date(candidate).toISOString();
    }
  }

  throw new Error(
    `Unable to convert local Asia/Shanghai datetime: ${JSON.stringify(parts)}`,
  );
}

function matchesShanghaiParts(
  timestamp: number,
  expected: DateTimeParts,
): boolean {
  const actual = toShanghaiDateTimeParts(new Date(timestamp));
  return (
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute &&
    actual.second === expected.second
  );
}

function toShanghaiDateTimeParts(date: Date): DateTimeParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (name: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === name)?.value ?? 0);

  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

export function formatLocalDate(value: string | Date): string {
  const date = typeof value === "string" ? parseUtc(value) : value;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: SHANGHAI_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function getShanghaiWeekday(value: string | Date): number {
  const date = typeof value === "string" ? parseUtc(value) : value;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHANGHAI_TIMEZONE,
    weekday: "short",
  }).formatToParts(date);
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Sun";
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
}

export function isWeekdayInShanghai(value: string | Date): boolean {
  const weekday = getShanghaiWeekday(value);
  return weekday >= 1 && weekday <= 5;
}
