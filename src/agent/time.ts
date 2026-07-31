/**
 * Time normalization utilities for meeting-room Agent intents.
 *
 * RFC-0002: Meeting Room Agent Orchestrator
 *
 * The LLM parser can return normalized `YYYY-MM-DD` dates and `HH:mm` time
 * ranges. These helpers provide deterministic defaults for relative dates and
 * common Chinese time expressions before intents are sent to backend APIs.
 */

export interface NormalizedTimeRange {
  startTime: string;
  endTime: string;
}

export type NormalizedDateExpression =
  | { valid: true; date: string; original: string }
  | { valid: false; original: string; reason: string };

export type NormalizedTimeRangeExpression =
  | { valid: true; timeRange: NormalizedTimeRange; original: string }
  | { valid: false; original: string; reason: string };

export interface NormalizeTimeOptions {
  /**
   * RFC-0002: Date normalization is based on the server timezone, defaulting to Asia/Shanghai.
   */
  timeZone?: string;
  /**
   * Anchor date used by tests and deterministic callers. Defaults to today in timeZone.
   */
  today?: string;
}

export interface TimeExpressionParts {
  date?: string;
  timeRange?: NormalizedTimeRange;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const EXPLICIT_TIME_RANGE_PATTERN = /^((?:[01]\d|2[0-3]):[0-5]\d)\s*(?:到|至|—|-|~|～)\s*((?:[01]\d|2[0-3]):[0-5]\d|24:00)$/;
const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const END_OF_DAY_TIME = '24:00';

const DEFAULT_TIME_RANGES: Record<string, NormalizedTimeRange> = {
  morning: { startTime: '09:00', endTime: '12:00' },
  noon: { startTime: '11:30', endTime: '13:30' },
  afternoon: { startTime: '13:00', endTime: '18:00' },
  evening: { startTime: '18:00', endTime: '21:00' },
  fullDay: { startTime: '00:00', endTime: '24:00' },
};

/**
 * Normalize a date expression such as `下周二`, `本周五`, `明天` or `2026-08-05`.
 *
 * RFC-0002: Relative date semantics are deterministic and timezone-aware.
 */
export function normalizeDateExpression(expression: string, options: NormalizeTimeOptions = {}): NormalizedDateExpression {
  const original = expression.trim();
  if (original === '') {
    return { valid: false, original, reason: 'date expression must not be empty.' };
  }

  if (DATE_PATTERN.test(original)) {
    return validateDateString(original, original);
  }

  const normalized = normalizeRelativeDate(original, options);
  if (normalized) {
    return { valid: true, date: normalized, original };
  }

  return {
    valid: false,
    original,
    reason: `Unsupported date expression: ${original}.`,
  };
}

/**
 * Normalize a time expression such as `上午`, `中午`, `下午`, `晚上`, `全天` or `10:00-11:00`.
 *
 * RFC-0002: Default time ranges are applied before backend conflict checking.
 */
export function normalizeTimeRangeExpression(expression: string): NormalizedTimeRangeExpression {
  const original = expression.trim();
  if (original === '') {
    return { valid: false, original, reason: 'time expression must not be empty.' };
  }

  const defaultRange = normalizeDefaultTimeRange(original);
  if (defaultRange) {
    return { valid: true, timeRange: defaultRange, original };
  }

  const explicitRange = parseExplicitTimeRange(original);
  if (explicitRange) {
    return { valid: true, timeRange: explicitRange, original };
  }

  return {
    valid: false,
    original,
    reason: `Unsupported time expression: ${original}.`,
  };
}

/**
 * Normalize an intent's date and/or time fields when they are still natural-language expressions.
 *
 * RFC-0002: Orchestrator-facing intents must expose `date: YYYY-MM-DD` and
 * `timeRange: { startTime: HH:mm, endTime: HH:mm }`.
 */
export function normalizeIntentTimeFields(
  intent: Record<string, unknown>,
  options: NormalizeTimeOptions = {},
): { valid: true; intent: Record<string, unknown> } | { valid: false; error: { message: string } } {
  const updated: Record<string, unknown> = { ...intent };
  const dateExpression = typeof updated.date === 'string' ? updated.date : undefined;
  const timeRangeExpression = typeof updated.timeRange === 'string' ? updated.timeRange : undefined;
  const combinedParts = extractDateAndTimeExpression(`${dateExpression ?? ''} ${timeRangeExpression ?? ''}`.trim(), options);

  if (updated.date === undefined && combinedParts.date) {
    updated.date = combinedParts.date;
  }

  if (updated.timeRange === undefined && combinedParts.timeRange) {
    updated.timeRange = combinedParts.timeRange;
  }

  if (typeof updated.date === 'string') {
    const dateValidation = normalizeDateExpression(updated.date, options);
    if (!dateValidation.valid) {
      return { valid: false, error: { message: dateValidation.reason } };
    }
    updated.date = dateValidation.date;
  }

  if (typeof updated.timeRange === 'string') {
    const timeRangeValidation = normalizeTimeRangeExpression(updated.timeRange);
    if (!timeRangeValidation.valid) {
      return { valid: false, error: { message: timeRangeValidation.reason } };
    }
    updated.timeRange = timeRangeValidation.timeRange;
  }

  return { valid: true, intent: updated };
}

/**
 * Extract date and default time range from a natural-language phrase.
 *
 * RFC-0002: Supports phrases like `明天中午`, `下周二上午`, `本周五下午` and `全天`.
 */
export function extractDateAndTimeExpression(phrase: string, options: NormalizeTimeOptions = {}): TimeExpressionParts {
  const normalizedPhrase = phrase.trim();
  if (normalizedPhrase === '') {
    return {};
  }

  const dateExpression = extractDateExpression(normalizedPhrase);
  const timeExpression = extractTimeExpression(normalizedPhrase);
  const normalizedDate = dateExpression ? normalizeDateExpression(dateExpression, options) : undefined;
  const normalizedTimeRange = timeExpression ? normalizeTimeRangeExpression(timeExpression) : undefined;

  return {
    ...(normalizedDate?.valid ? { date: normalizedDate.date } : {}),
    ...(normalizedTimeRange?.valid ? { timeRange: normalizedTimeRange.timeRange } : {}),
  };
}

function normalizeRelativeDate(expression: string, options: NormalizeTimeOptions): string | undefined {
  const today = resolveToday(options);
  const lower = expression.toLowerCase();

  if (lower === '今天' || lower === '今日' || lower === 'today') {
    return formatDate(today);
  }

  if (lower === '明天' || lower === '明日' || lower === 'tomorrow') {
    return formatDate(addDays(today, 1));
  }

  if (lower === '后天' || lower === '後天' || lower === 'day after tomorrow') {
    return formatDate(addDays(today, 2));
  }

  const relativeWeekday = parseRelativeWeekday(lower, today);
  if (relativeWeekday) {
    return formatDate(addDays(today, relativeWeekday.offset));
  }

  return undefined;
}

function parseRelativeWeekday(expression: string, today: Date): { offset: number } | undefined {
  const weekday = parseWeekday(expression);
  if (weekday === undefined) {
    return undefined;
  }

  const todayWeekday = today.getDay();
  let offset = weekday - todayWeekday;

  if (expression.startsWith('上周') || expression.startsWith('上个星期') || expression.startsWith('上个礼拜')) {
    offset -= 7;
  }

  if (expression.startsWith('本周') || expression.startsWith('这周') || expression.startsWith('这个星期') || expression.startsWith('这礼拜')) {
    if (offset < 0) {
      return undefined;
    }
  }

  if (expression.startsWith('下周') || expression.startsWith('下个星期') || expression.startsWith('下个礼拜')) {
    offset += 7;
  }

  if (offset < 0) {
    offset += 7;
  }

  return { offset };
}

function parseWeekday(expression: string): number | undefined {
  const aliases: Record<number, string[]> = {
    0: ['周日', '星期天', '礼拜日', '礼拜天'],
    1: ['周一', '星期一', '礼拜一'],
    2: ['周二', '星期二', '礼拜二'],
    3: ['周三', '星期三', '礼拜三'],
    4: ['周四', '星期四', '礼拜四'],
    5: ['周五', '星期五', '礼拜五'],
    6: ['周六', '星期六', '礼拜六'],
  };

  for (const [day, names] of Object.entries(aliases)) {
    if (names.some((name) => expression.includes(name))) {
      return Number(day);
    }
  }

  return undefined;
}

function normalizeDefaultTimeRange(expression: string): NormalizedTimeRange | undefined {
  const lower = expression.toLowerCase();

  if (lower === '上午' || lower === '早上' || lower === 'morning') {
    return DEFAULT_TIME_RANGES.morning;
  }

  if (lower === '中午' || lower === '午间' || lower === 'noon') {
    return DEFAULT_TIME_RANGES.noon;
  }

  if (lower === '下午' || lower === 'afternoon') {
    return DEFAULT_TIME_RANGES.afternoon;
  }

  if (lower === '晚上' || lower === '晚间' || lower === 'evening') {
    return DEFAULT_TIME_RANGES.evening;
  }

  if (lower === '全天' || lower === '整天' || lower === 'all day') {
    return DEFAULT_TIME_RANGES.fullDay;
  }

  return undefined;
}

function parseExplicitTimeRange(expression: string): NormalizedTimeRange | undefined {
  const match = EXPLICIT_TIME_RANGE_PATTERN.exec(expression);
  if (!match) {
    return undefined;
  }

  const startTime = match[1];
  const endTime = match[2];
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);

  if (startMinutes === undefined || endMinutes === undefined || startMinutes >= endMinutes) {
    return undefined;
  }

  return { startTime, endTime };
}

function extractDateExpression(phrase: string): string | undefined {
  const absoluteDate = /\d{4}-\d{2}-\d{2}/.exec(phrase);
  if (absoluteDate) {
    return absoluteDate[0];
  }

  const relativePatterns = [
    /(本周|这周|这个星期|下周|下个星期|这礼拜|下个礼拜)[一二三四五六日天]/,
    /明天/,
    /明日/,
    /后天/,
    /後天/,
    /今天/,
    /今日/,
  ];

  for (const pattern of relativePatterns) {
    const match = pattern.exec(phrase);
    if (match) {
      return match[0];
    }
  }

  return undefined;
}

function extractTimeExpression(phrase: string): string | undefined {
  const explicitRange = /((?:[01]\d|2[0-3]):[0-5]\d)\s*(?:到|至|—|-|~|～)\s*((?:[01]\d|2[0-3]):[0-5]\d|24:00)/.exec(phrase);
  if (explicitRange) {
    return explicitRange[0];
  }

  const defaultTimeExpressions = ['全天', '下午', '上午', '中午', '晚上', '早上', '午间', '晚间', '整天'];
  for (const expression of defaultTimeExpressions) {
    if (phrase.includes(expression)) {
      return expression;
    }
  }

  return undefined;
}

function resolveToday(options: NormalizeTimeOptions): Date {
  if (options.today) {
    const parsed = parseDateOnly(options.today);
    if (parsed) {
      return parsed;
    }
  }

  const timeZone = options.timeZone ?? process.env.MEETING_ROOM_TIME_ZONE ?? DEFAULT_TIME_ZONE;
  return getTodayInTimeZone(timeZone);
}

function getTodayInTimeZone(timeZone: string): Date {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date())
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    ) as Record<string, string>;
    const parsed = parseDateOnly(`${parts.year}-${parts.month}-${parts.day}`);
    if (parsed) {
      return parsed;
    }
  } catch {
    // Fall back to local date if the configured timezone is unavailable.
  }

  return new Date();
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string): Date | undefined {
  if (!DATE_PATTERN.test(value)) {
    return undefined;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return undefined;
  }

  return date;
}

function validateDateString(value: string, path: string): NormalizedDateExpression {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return { valid: false, original: value, reason: `${path} must be a valid calendar date.` };
  }

  return { valid: true, date: value, original: value };
}

function timeToMinutes(value: string): number | undefined {
  if (value === END_OF_DAY_TIME) {
    return 24 * 60;
  }

  const match = TIME_PATTERN.exec(value);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(value.slice(3, 5));
  return hours * 60 + minutes;
}
