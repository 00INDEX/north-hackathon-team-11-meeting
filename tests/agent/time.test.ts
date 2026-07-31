import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractDateAndTimeExpression,
  normalizeDateExpression,
  normalizeIntentTimeFields,
  normalizeTimeRangeExpression,
} from '../../src/agent/time.js';

test('normalizeDateExpression handles relative dates anchored to a fixed today', () => {
  const cases = [
    ['下周二', '2026-08-04'],
    ['本周五', '2026-07-31'],
    ['明天', '2026-07-30'],
    ['后天', '2026-07-31'],
    ['今天', '2026-07-29'],
    ['2026-08-05', '2026-08-05'],
  ] as const;

  for (const [expression, expected] of cases) {
    const result = normalizeDateExpression(expression, { today: '2026-07-29' });
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.equal(result.date, expected);
    }
  }
});

test('normalizeDateExpression rejects unsupported relative dates', () => {
  const result = normalizeDateExpression('大后天', { today: '2026-07-29' });

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.match(result.reason, /Unsupported date expression/);
  }
});

test('normalizeTimeRangeExpression handles RFC-0002 default time semantics', () => {
  const cases = [
    ['上午', { startTime: '09:00', endTime: '12:00' }],
    ['中午', { startTime: '11:30', endTime: '13:30' }],
    ['下午', { startTime: '13:00', endTime: '18:00' }],
    ['晚上', { startTime: '18:00', endTime: '21:00' }],
    ['全天', { startTime: '00:00', endTime: '24:00' }],
  ] as const;

  for (const [expression, expected] of cases) {
    const result = normalizeTimeRangeExpression(expression);
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.deepEqual(result.timeRange, expected);
    }
  }
});

test('normalizeTimeRangeExpression handles explicit time ranges', () => {
  const cases = [
    ['10:00-11:00', { startTime: '10:00', endTime: '11:00' }],
    ['14:00到16:00', { startTime: '14:00', endTime: '16:00' }],
    ['00:00-24:00', { startTime: '00:00', endTime: '24:00' }],
  ] as const;

  for (const [expression, expected] of cases) {
    const result = normalizeTimeRangeExpression(expression);
    assert.equal(result.valid, true);
    if (result.valid) {
      assert.deepEqual(result.timeRange, expected);
    }
  }
});

test('extractDateAndTimeExpression handles combined date and time phrases', () => {
  assert.deepEqual(
    extractDateAndTimeExpression('下周二 10:00 到 11:00', { today: '2026-07-29' }),
    {
      date: '2026-08-04',
      timeRange: { startTime: '10:00', endTime: '11:00' },
    },
  );

  assert.deepEqual(
    extractDateAndTimeExpression('明天中午', { today: '2026-07-29' }),
    {
      date: '2026-07-30',
      timeRange: { startTime: '11:30', endTime: '13:30' },
    },
  );

  assert.deepEqual(
    extractDateAndTimeExpression('本周五下午', { today: '2026-07-29' }),
    {
      date: '2026-07-31',
      timeRange: { startTime: '13:00', endTime: '18:00' },
    },
  );

  assert.deepEqual(
    extractDateAndTimeExpression('全天', { today: '2026-07-29' }),
    {
      timeRange: { startTime: '00:00', endTime: '24:00' },
    },
  );
});

test('normalizeIntentTimeFields normalizes natural-language fields in an intent', () => {
  const result = normalizeIntentTimeFields(
    {
      type: 'query_available_rooms',
      date: '下周二',
      timeRange: '下午',
    },
    { today: '2026-07-29' },
  );

  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.intent, {
      type: 'query_available_rooms',
      date: '2026-08-04',
      timeRange: { startTime: '13:00', endTime: '18:00' },
    });
  }
});
