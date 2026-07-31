import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgentIntent, validateAgentIntent } from '../../src/agent/schema.js';

test('parseAgentIntent accepts query_available_rooms with required fields', () => {
  const result = parseAgentIntent(
    JSON.stringify({
      type: 'query_available_rooms',
      date: '2026-08-04',
      timeRange: {
        startTime: '10:00',
        endTime: '11:00',
      },
      filters: {
        roomType: 'small',
        minCapacity: 4,
        equipment: ['projector'],
      },
    }),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.intent?.type, 'query_available_rooms');
});

test('parseAgentIntent accepts create_booking with required fields', () => {
  const result = parseAgentIntent(
    JSON.stringify({
      type: 'create_booking',
      userId: 'u_001',
      roomId: '506',
      date: '2026-08-05',
      timeRange: {
        startTime: '10:00',
        endTime: '11:00',
      },
      title: '项目讨论',
      attendees: 6,
    }),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.intent?.type, 'create_booking');
});

test('parseAgentIntent accepts create_unavailability_rule for one-time full-day rule', () => {
  const result = parseAgentIntent(
    JSON.stringify({
      type: 'create_unavailability_rule',
      target: '505',
      date: '2026-08-05',
      timeRange: {
        startTime: '00:00',
        endTime: '24:00',
      },
      reason: '临时维修',
    }),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.intent?.type, 'create_unavailability_rule');
});

test('parseAgentIntent accepts RFC-0002 506 rule correction intent', () => {
  const createResult = parseAgentIntent(
    JSON.stringify({
      type: 'create_unavailability_rule',
      target: 'room-506',
      date: '2026-07-29',
      timeRange: {
        startTime: '00:00',
        endTime: '24:00',
      },
      reason: '临时维修',
    }),
  );
  const updateResult = parseAgentIntent(
    JSON.stringify({
      type: 'update_last_unavailability_rule',
      target: 'room-506',
      date: '2026-07-29',
      timeRange: {
        startTime: '13:00',
        endTime: '18:00',
      },
      reason: '下午维修',
    }),
  );

  assert.equal(createResult.error, undefined);
  assert.equal(createResult.intent?.type, 'create_unavailability_rule');
  assert.equal(updateResult.error, undefined);
  assert.equal(updateResult.intent?.type, 'update_last_unavailability_rule');
});

test('parseAgentIntent accepts update_last_unavailability_rule', () => {
  const result = parseAgentIntent(
    JSON.stringify({
      type: 'update_last_unavailability_rule',
      timeRange: {
        startTime: '13:00',
        endTime: '18:00',
      },
      reason: '下午维修',
    }),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.intent?.type, 'update_last_unavailability_rule');
});

test('parseAgentIntent accepts create_or_update_room', () => {
  const result = parseAgentIntent(
    JSON.stringify({
      type: 'create_or_update_room',
      roomId: '506',
      capacity: 6,
      roomType: 'medium',
      equipment: ['screen'],
    }),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.intent?.type, 'create_or_update_room');
});

test('parseAgentIntent accepts create_combined_room', () => {
  const result = parseAgentIntent(
    JSON.stringify({
      type: 'create_combined_room',
      combinedRoomId: 'combined_room_1_2',
      name: '大会议室',
      componentRoomIds: ['room-meeting-1', 'room-meeting-2'],
      capacity: 12,
    }),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.intent?.type, 'create_combined_room');
  assert.deepEqual(result.intent?.componentRoomIds, ['room-meeting-1', 'room-meeting-2']);
});

test('parseAgentIntent accepts need_clarification', () => {
  const result = parseAgentIntent(
    JSON.stringify({
      type: 'need_clarification',
      missingFields: ['date', 'startTime', 'endTime'],
      clarification: '请告诉我你想预约哪一天，以及具体开始和结束时间。',
    }),
  );

  assert.equal(result.error, undefined);
  assert.equal(result.intent?.type, 'need_clarification');
});

test('parseAgentIntent rejects malformed JSON', () => {
  const result = parseAgentIntent('{ type: "create_booking" }');

  assert.equal(result.intent, undefined);
  assert.equal(result.error?.type, 'parse_failed');
});

test('validateAgentIntent rejects missing required fields', () => {
  const result = validateAgentIntent({
    type: 'create_booking',
    userId: 'u_001',
    roomId: '506',
    date: '2026-08-05',
  });

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.error.type, 'parse_failed');
    assert.match(result.error.message, /Missing required field\(s\): timeRange/);
  }
});

test('validateAgentIntent rejects unknown intent type', () => {
  const result = validateAgentIntent({
    type: 'unknown_intent',
  });

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.equal(result.error.type, 'parse_failed');
    assert.match(result.error.message, /Unsupported intent type/);
  }
});

test('validateAgentIntent rejects invalid date and time formats', () => {
  const dateResult = validateAgentIntent({
    type: 'query_available_rooms',
    date: '2026-02-30',
    timeRange: {
      startTime: '10:00',
      endTime: '11:00',
    },
  });

  assert.equal(dateResult.valid, false);
  if (!dateResult.valid) {
    assert.match(dateResult.error.message, /valid calendar date/);
  }

  const timeResult = validateAgentIntent({
    type: 'query_available_rooms',
    date: '2026-08-04',
    timeRange: {
      startTime: '25:00',
      endTime: '26:00',
    },
  });

  assert.equal(timeResult.valid, false);
  if (!timeResult.valid) {
    assert.match(timeResult.error.message, /HH:mm format/);
  }
});

test('validateAgentIntent rejects duplicate combined room components', () => {
  const result = validateAgentIntent({
    type: 'create_combined_room',
    combinedRoomId: 'combined_room_1_2',
    componentRoomIds: ['room_1', 'room_1'],
  });

  assert.equal(result.valid, false);
  if (!result.valid) {
    assert.match(result.error.message, /must not contain duplicates/);
  }
});
