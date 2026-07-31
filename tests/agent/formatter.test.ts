import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAgentMessage } from '../../src/agent/formatter.js';

test('formatAgentMessage formats available room list', () => {
  const intent: import('../../src/agent/types.js').AgentIntent = {
    type: 'query_available_rooms',
    date: '2026-08-04',
    timeRange: { startTime: '10:00', endTime: '11:00' },
    filters: { roomType: 'small', minCapacity: 6 },
  };

  const response = formatAgentMessage({
    intent,
    orchestratorResult: {
      actions: [{ type: 'query_available_rooms', status: 'completed' }],
      data: {
        availableRooms: [
          { id: 'room-506', name: '506', capacity: 6, type: 'small', location: 'A 座' },
          { id: 'room-507', name: '507', capacity: 8, type: 'small', location: 'B 座' },
        ],
      },
    },
  });

  assert.equal(response.parsedIntent, intent);
  assert.equal(response.error, null);
  assert.equal(response.reply, '2026-08-04 10:00—11:00，筛选条件：小会议室、至少 6 人可用会议室：506 6 人（A 座）；507 8 人（B 座）。');
});

test('formatAgentMessage formats booking success', () => {
  const intent = {
    type: 'create_booking' as const,
    userId: 'u_001',
    roomId: 'room-506',
    date: '2026-08-05',
    timeRange: { startTime: '10:00', endTime: '11:00' },
    title: '项目讨论',
  };

  const response = formatAgentMessage({
    intent,
    orchestratorResult: {
      actions: [{ type: 'create_booking', status: 'completed' }],
      data: {
        booking: {
          id: 'booking-1',
          title: '项目讨论',
          roomId: 'room-506',
          date: '2026-08-05',
          startTime: '10:00',
          endTime: '11:00',
          status: 'active',
        },
      },
    },
  });

  assert.equal(response.reply, '预约成功：「项目讨论」 2026-08-05 10:00—11:00 506。');
});

test('formatAgentMessage formats cancellation result', () => {
  const intent = {
    type: 'cancel_booking' as const,
    bookingId: 'booking-1',
  };

  const response = formatAgentMessage({
    intent,
    orchestratorResult: {
      actions: [{ type: 'cancel_booking', status: 'completed' }],
      data: {
        booking: {
          id: 'booking-1',
          title: '项目讨论',
          roomId: 'room-506',
          date: '2026-08-05',
          startTime: '10:00',
          endTime: '11:00',
          status: 'cancelled',
        },
      },
    },
  });

  assert.equal(response.reply, '已取消预约：「项目讨论」 2026-08-05 10:00—11:00 506。');
});

test('formatAgentMessage formats unavailability rule update', () => {
  const intent = {
    type: 'update_last_unavailability_rule' as const,
    timeRange: { startTime: '13:00', endTime: '18:00' },
    reason: '下午维修',
  };

  const response = formatAgentMessage({
    intent,
    orchestratorResult: {
      actions: [{ type: 'update_last_unavailability_rule', status: 'completed', payload: { target: 'room-506' } }],
      data: {
        updatedRuleId: 'rule-1',
        rule: {
          id: 'rule-1',
          target: 'room-506',
          date: '2026-08-05',
          timeRange: { startTime: '13:00', endTime: '18:00' },
          reason: '下午维修',
        },
      },
    },
  });

  assert.equal(response.reply, '更新不可预约规则成功，已更新规则 rule-1。目标：506，2026-08-05 13:00—18:00，原因：下午维修。');
});

test('formatAgentMessage formats conflict reason', () => {
  const intent = {
    type: 'create_booking' as const,
    userId: 'u_001',
    roomId: 'room-activity',
    date: '2026-08-05',
    timeRange: { startTime: '12:00', endTime: '13:00' },
  };

  const response = formatAgentMessage({
    intent,
    orchestratorResult: {
      actions: [{ type: 'create_booking', status: 'failed' }],
      error: {
        type: 'conflict',
        message: '该时间段与现有规则冲突。',
        details: {
          conflicts: [
            {
              type: 'rule',
              id: 'rule-activity-lunch',
              name: '活动室午餐规则',
              start: '2026-08-05T11:30:00+08:00',
              end: '2026-08-05T13:30:00+08:00',
              reason: '午餐时段不可预约',
            },
          ],
        },
      },
    },
  });

  assert.equal(response.error?.type, 'conflict');
  assert.equal(response.reply, '预约冲突：活动室午餐规则（2026-08-05 11:30 至 2026-08-05 13:30），午餐时段不可预约');
});

test('formatAgentMessage formats permission, parse, and backend unavailable errors', () => {
  const intent = {
    type: 'create_unavailability_rule' as const,
    target: 'room-506',
    reason: '临时维修',
  };

  assert.equal(formatAgentMessage({
    intent,
    orchestratorResult: {
      actions: [{ type: 'create_unavailability_rule', status: 'failed' }],
      error: { type: 'permission_denied', message: '无权限。' },
    },
  }).reply, '抱歉，当前账号没有权限执行这个操作。你可以联系管理员确认权限后重试。');

  assert.equal(formatAgentMessage({
    parserError: { type: 'parse_failed', message: 'LLM parser response is not valid JSON.' },
  }).reply, '抱歉，我暂时没有解析成功：LLM parser response is not valid JSON.。请换一种说法重试，或提供更明确的日期、时间、房间和标题。');

  assert.equal(formatAgentMessage({
    parserError: { type: 'backend_unavailable', message: 'Nex LLM parser request failed.' },
  }).reply, '抱歉，服务暂时不可用，请稍后重试。');
});

test('formatAgentMessage formats clarification intent', () => {
  const response = formatAgentMessage({
    intent: {
      type: 'need_clarification' as const,
      missingFields: ['date', 'timeRange'],
      clarification: '请补充日期和时间。',
    },
  });

  assert.equal(response.reply, '请补充日期和时间。');
  assert.equal(response.parsedIntent?.type, 'need_clarification');
});
