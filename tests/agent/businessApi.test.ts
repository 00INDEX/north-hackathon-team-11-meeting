import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBusinessApiClient,
  orchestrateAgentIntent,
  type BackendBusinessApiClient,
  type ConflictDetail,
} from '../../src/agent/businessApi.js';

test('orchestrateAgentIntent maps query_available_rooms to availability API', async () => {
  const client = mockBusinessApiClient({
    checkAvailability: async (request) => {
      assert.deepEqual(request, {
        date: '2026-08-04',
        startTime: '10:00',
        endTime: '11:00',
        filters: { roomType: 'small' },
      });
      return {
        availableRooms: [{ id: 'room-506', name: '506', capacity: 6, type: 'small', location: 'A 座' }],
      };
    },
  });

  const result = await orchestrateAgentIntent({
    type: 'query_available_rooms',
    date: '2026-08-04',
    timeRange: { startTime: '10:00', endTime: '11:00' },
    filters: { roomType: 'small' },
  }, { userId: 'u_001', client });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.actions, [{
    type: 'query_available_rooms',
    status: 'completed',
    endpoint: '/api/availability/check',
    payload: {
      date: '2026-08-04',
      startTime: '10:00',
      endTime: '11:00',
      filters: { roomType: 'small' },
    },
    result: {
      availableRooms: [{ id: 'room-506', name: '506', capacity: 6, type: 'small', location: 'A 座' }],
    },
  }]);
  assert.deepEqual(result.data, {
    availableRooms: [{ id: 'room-506', name: '506', capacity: 6, type: 'small', location: 'A 座' }],
  });
});

test('orchestrateAgentIntent maps create_booking to backend booking API', async () => {
  const client = mockBusinessApiClient({
    createBooking: async (request) => {
      assert.deepEqual(request, {
        userId: 'u_001',
        roomId: 'room-506',
        date: '2026-08-05',
        startTime: '10:00',
        endTime: '11:00',
        title: '项目讨论',
        description: '需求评审',
        attendees: 6,
      });
      return {
        booking: {
          id: 'booking-1',
          title: '项目讨论',
          roomId: 'room-506',
          date: '2026-08-05',
          startTime: '10:00',
          endTime: '11:00',
          status: 'active',
        },
      };
    },
  });

  const result = await orchestrateAgentIntent({
    type: 'create_booking',
    userId: 'u_001',
    roomId: 'room-506',
    date: '2026-08-05',
    timeRange: { startTime: '10:00', endTime: '11:00' },
    title: '项目讨论',
    description: '需求评审',
    attendees: 6,
  }, { userId: 'fallback-user', authContext: { role: 'member' }, client });

  assert.equal(result.error, undefined);
  assert.equal(result.actions[0].status, 'completed');
  assert.equal(result.actions[0].endpoint, '/api/bookings');
});

test('orchestrateAgentIntent maps cancel_booking to backend delete API', async () => {
  const client = mockBusinessApiClient({
    cancelBooking: async (request) => {
      assert.equal(request.bookingId, 'booking-1');
      assert.equal(request.userId, 'u_001');
      return {
        booking: {
          id: 'booking-1',
          title: '项目讨论',
          roomId: 'room-506',
          date: '2026-08-05',
          startTime: '10:00',
          endTime: '11:00',
          status: 'cancelled',
        },
      };
    },
  });

  const result = await orchestrateAgentIntent({
    type: 'cancel_booking',
    bookingId: 'booking-1',
  }, { userId: 'u_001', client });

  assert.equal(result.error, undefined);
  assert.equal(result.actions[0].endpoint, '/api/bookings');
});

test('orchestrateAgentIntent maps unavailability rule create and update to backend APIs', async () => {
  const client = mockBusinessApiClient({
    createUnavailabilityRule: async (request) => {
      assert.equal(request.target, 'room-506');
      assert.equal(request.date, '2026-08-05');
      assert.deepEqual(request.timeRange, { startTime: '00:00', endTime: '24:00' });
      assert.equal(request.reason, '临时维修');
      return { rule: { id: 'rule-1', target: 'room-506', reason: '临时维修' } };
    },
    updateUnavailabilityRule: async (request) => {
      assert.deepEqual(request.timeRange, { startTime: '13:00', endTime: '18:00' });
      assert.equal(request.reason, '下午维修');
      return { rule: { id: 'rule-1', target: 'room-506', reason: '下午维修' } };
    },
  });

  const createResult = await orchestrateAgentIntent({
    type: 'create_unavailability_rule',
    target: 'room-506',
    date: '2026-08-05',
    timeRange: { startTime: '00:00', endTime: '24:00' },
    reason: '临时维修',
  }, { userId: 'u_001', client });

  assert.equal(createResult.error, undefined);
  assert.equal(createResult.actions[0].endpoint, '/api/unavailability-rules');

  const updateResult = await orchestrateAgentIntent({
    type: 'update_last_unavailability_rule',
    timeRange: { startTime: '13:00', endTime: '18:00' },
    reason: '下午维修',
  }, { userId: 'u_001', client });

  assert.equal(updateResult.error, undefined);
  assert.equal(updateResult.actions[0].endpoint, '/api/unavailability-rules/last');
});

test('orchestrateAgentIntent maps room config and combined room to backend APIs', async () => {
  const client = mockBusinessApiClient({
    createOrUpdateRoom: async (request) => {
      assert.equal(request.roomId, 'room-506');
      assert.equal(request.name, '506 会议室');
      assert.equal(request.capacity, 8);
      assert.equal(request.roomType, 'medium');
      assert.deepEqual(request.equipment, ['screen']);
      return { room: { id: 'room-506', name: '506 会议室', capacity: 8, type: 'medium', location: 'A 座' } };
    },
    createCombinedRoom: async (request) => {
      assert.equal(request.combinedRoomId, 'combined_room_1_2');
      assert.equal(request.name, '大会议室');
      assert.deepEqual(request.componentRoomIds, ['room-1', 'room-2']);
      assert.equal(request.capacity, 12);
      return { room: { id: 'combined_room_1_2', name: '大会议室', capacity: 12, type: 'combined', location: 'A 座' } };
    },
  });

  const roomResult = await orchestrateAgentIntent({
    type: 'create_or_update_room',
    roomId: 'room-506',
    name: '506 会议室',
    capacity: 8,
    roomType: 'medium',
    equipment: ['screen'],
  }, { userId: 'u_admin', client });

  assert.equal(roomResult.error, undefined);
  assert.equal(roomResult.actions[0].endpoint, '/api/rooms/room-506');

  const combinedResult = await orchestrateAgentIntent({
    type: 'create_combined_room',
    combinedRoomId: 'combined_room_1_2',
    name: '大会议室',
    componentRoomIds: ['room-1', 'room-2'],
    capacity: 12,
  }, { userId: 'u_admin', client });

  assert.equal(combinedResult.error, undefined);
  assert.equal(combinedResult.actions[0].endpoint, '/api/room-groups');
});

test('orchestrateAgentIntent returns no action for need_clarification', async () => {
  const client = mockBusinessApiClient();

  const result = await orchestrateAgentIntent({
    type: 'need_clarification',
    missingFields: ['date', 'timeRange'],
    clarification: '请补充日期和时间。',
  }, { userId: 'u_001', client });

  assert.deepEqual(result, { actions: [] });
});

test('orchestrateAgentIntent propagates backend conflict errors without mutating action status to completed', async () => {
  const conflict: ConflictDetail = {
    type: 'rule',
    id: 'rule-activity-lunch',
    name: '活动室午餐规则',
    start: '2026-08-05T11:30:00+08:00',
    end: '2026-08-05T13:30:00+08:00',
    reason: '午餐时段不可预约',
  };
  const client = mockBusinessApiClient({
    createBooking: async () => {
      throw {
        type: 'conflict',
        message: '该时间段与现有规则冲突。',
        details: { conflicts: [conflict] },
      };
    },
  });

  const result = await orchestrateAgentIntent({
    type: 'create_booking',
    roomId: 'room-activity',
    date: '2026-08-05',
    timeRange: { startTime: '12:00', endTime: '13:00' },
    userId: 'u_001',
  }, { userId: 'u_001', client });

  assert.deepEqual(result.error, {
    type: 'conflict',
    message: '该时间段与现有规则冲突。',
    details: { conflicts: [conflict] },
  });
  assert.equal(result.actions[0].status, 'failed');
  assert.equal(result.actions[0].error?.type, 'conflict');
});

test('orchestrateAgentIntent propagates backend permission_denied errors', async () => {
  const client = mockBusinessApiClient({
    createUnavailabilityRule: async () => {
      throw {
        type: 'permission_denied',
        message: '当前用户无权限创建不可预约规则。',
      };
    },
  });

  const result = await orchestrateAgentIntent({
    type: 'create_unavailability_rule',
    target: 'room-506',
    reason: '临时维修',
  }, { userId: 'u_member', client });

  assert.deepEqual(result.error, {
    type: 'permission_denied',
    message: '当前用户无权限创建不可预约规则。',
  });
  assert.equal(result.actions[0].status, 'failed');
  assert.equal(result.actions[0].error?.type, 'permission_denied');
});

test('createBusinessApiClient sends RFC backend business API contracts', async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: input.toString(), init });
    const path = input.toString().replace('https://backend.example.test', '');
    if (path === '/api/availability/check') {
      return jsonResponse({ availableRooms: [{ id: 'room-506' }] });
    }
    if (path === '/api/bookings') {
      return jsonResponse({ booking: { id: 'booking-1', status: 'active' } });
    }
    if (path === '/api/bookings/booking-1') {
      return jsonResponse({ booking: { id: 'booking-1', status: 'cancelled' } });
    }
    if (path === '/api/bookings/conflict-check') {
      return jsonResponse({ available: true });
    }
    if (path === '/api/rooms') {
      return jsonResponse([{ id: 'room-506', name: '506' }]);
    }
    if (path === '/api/unavailability-rules') {
      return jsonResponse({ rule: { id: 'rule-1' } });
    }
    if (path === '/api/unavailability-rules/last') {
      return jsonResponse({ rule: { id: 'rule-1' } });
    }
    if (path === '/api/rooms/room-506') {
      return jsonResponse({ room: { id: 'room-506', capacity: 8 } });
    }
    if (path === '/api/room-groups') {
      return jsonResponse({ room: { id: 'combined_room_1_2' } });
    }
    return jsonResponse({});
  };

  try {
    const client = createBusinessApiClient({ baseUrl: 'https://backend.example.test' });

    await client.checkAvailability({ date: '2026-08-04', startTime: '10:00', endTime: '11:00' });
    await client.createBooking({ userId: 'u_001', roomId: 'room-506', date: '2026-08-05', startTime: '10:00', endTime: '11:00' });
    await client.cancelBooking({ bookingId: 'booking-1' });
    await client.conflictCheck({ roomId: 'room-506', date: '2026-08-05', startTime: '10:00', endTime: '11:00' });
    await client.listRooms();
    await client.createUnavailabilityRule({ target: 'room-506', reason: '维修' });
    await client.updateUnavailabilityRule({ reason: '下午维修' });
    await client.createOrUpdateRoom({ roomId: 'room-506', capacity: 8 });
    await client.createCombinedRoom({ combinedRoomId: 'combined_room_1_2', componentRoomIds: ['room-1', 'room-2'] });

    assert.deepEqual(requests.map((request) => [request.url, request.init?.method]), [
      ['https://backend.example.test/api/availability/check', 'POST'],
      ['https://backend.example.test/api/bookings', 'POST'],
      ['https://backend.example.test/api/bookings/booking-1', 'DELETE'],
      ['https://backend.example.test/api/bookings/conflict-check', 'POST'],
      ['https://backend.example.test/api/rooms', 'GET'],
      ['https://backend.example.test/api/unavailability-rules', 'POST'],
      ['https://backend.example.test/api/unavailability-rules/last', 'PATCH'],
      ['https://backend.example.test/api/rooms/room-506', 'POST'],
      ['https://backend.example.test/api/room-groups', 'POST'],
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('createBusinessApiClient maps backend permission and conflict HTTP errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: 'RESERVATION_CONFLICT',
      message: '该房间已被预约。',
      conflicts: [{ type: 'reservation', id: 'booking-1', name: '项目讨论' }],
    },
  }), { status: 409, headers: { 'content-type': 'application/json' } });

  try {
    const client = createBusinessApiClient({ baseUrl: 'https://backend.example.test' });

    await assert.rejects(
      client.createBooking({ userId: 'u_001', roomId: 'room-506', date: '2026-08-05', startTime: '10:00', endTime: '11:00' }),
      (error) => {
        assert.deepEqual(error, {
          type: 'conflict',
          message: '该房间已被预约。',
          details: {
            httpStatus: 409,
            code: 'RESERVATION_CONFLICT',
            conflicts: [{ type: 'reservation', id: 'booking-1', name: '项目讨论' }],
          },
        });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  globalThis.fetch = async () => new Response(JSON.stringify({
    error: {
      code: 'PERMISSION_DENIED',
      message: '无权限。',
    },
  }), { status: 403, headers: { 'content-type': 'application/json' } });

  try {
    const client = createBusinessApiClient({ baseUrl: 'https://backend.example.test' });

    await assert.rejects(
      client.createUnavailabilityRule({ target: 'room-506', reason: '维修' }),
      (error) => {
        assert.deepEqual(error, {
          type: 'permission_denied',
          message: '无权限。',
          details: {
            httpStatus: 403,
            code: 'PERMISSION_DENIED',
            conflicts: undefined,
          },
        });
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function mockBusinessApiClient(partialClient: Partial<BackendBusinessApiClient> = {}): BackendBusinessApiClient {
  return {
    checkAvailability: async () => ({ availableRooms: [] }),
    createBooking: async () => ({ booking: { id: 'booking-1', title: '', roomId: '', date: '', startTime: '', endTime: '', status: 'active' } }),
    cancelBooking: async () => ({ booking: { id: 'booking-1', title: '', roomId: '', date: '', startTime: '', endTime: '', status: 'cancelled' } }),
    conflictCheck: async () => ({ available: true }),
    listRooms: async () => [],
    createUnavailabilityRule: async () => ({}),
    updateUnavailabilityRule: async () => ({}),
    createOrUpdateRoom: async () => ({}),
    createCombinedRoom: async () => ({}),
    ...partialClient,
  };
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
