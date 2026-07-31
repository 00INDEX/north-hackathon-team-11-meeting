import { describe, expect, it } from 'vitest';
import {
  APP_TIMEZONE,
  combineLocalDateTime,
  formatLocalDate,
  getShanghaiWeekday,
  isWeekdayInShanghai,
} from '@/time';

describe('Asia/Shanghai time contract', () => {
  it('keeps the application timezone fixed to Asia/Shanghai', () => {
    expect(APP_TIMEZONE).toBe('Asia/Shanghai');
  });

  it('converts local Asia/Shanghai date-time to UTC without using host timezone', () => {
    expect(combineLocalDateTime('2026-01-06', '09:00')).toBe('2026-01-06T01:00:00.000Z');
    expect(combineLocalDateTime('2026-07-31', '22:00')).toBe('2026-07-31T14:00:00.000Z');
  });

  it('evaluates weekdays and local dates in Asia/Shanghai', () => {
    expect(getShanghaiWeekday('2026-01-06T01:00:00.000Z')).toBe(2);
    expect(isWeekdayInShanghai('2026-01-06T01:00:00.000Z')).toBe(true);
    expect(formatLocalDate('2026-07-31T14:00:00.000Z')).toBe('2026/07/31');
  });
});
