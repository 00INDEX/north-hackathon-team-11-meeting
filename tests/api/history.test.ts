import assert from 'node:assert/strict';
import test from 'node:test';
import { createConversationHistoryClient } from '../../src/api/history.js';

test('createConversationHistoryClient fetches complete history contract', async () => {
  const historyPayload = [
    {
      role: 'user',
      content: '帮我查一下明天下午有没有会议室',
      parsedIntent: { type: 'query_available_rooms', date: '2026-07-30', timeRange: { startTime: '13:00', endTime: '18:00' } },
    },
    {
      role: 'assistant',
      content: '已帮你查询明天下午的可用会议室。',
      actions: [{ type: 'query_available_rooms', status: 'completed' }],
    },
    {
      role: 'user',
      content: '',
    },
    { role: 'system', content: '系统消息会被过滤' },
  ];

  const client = createConversationHistoryClient('https://example.test', async (url) => {
    assert.equal(String(url), 'https://example.test/api/conversations/conv%201/history');

    return new Response(JSON.stringify(historyPayload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });

  const history = await client.getHistory('conv 1');

  assert.deepEqual(history, [historyPayload[0], historyPayload[1]]);
});

test('createConversationHistoryClient rejects non-array history responses', async () => {
  const client = createConversationHistoryClient('https://example.test', async () => new Response(JSON.stringify({})));

  await assert.rejects(client.getHistory('conv 1'), /Conversation history API must return an array/);
});

test('createConversationHistoryClient propagates backend errors', async () => {
  const client = createConversationHistoryClient('https://example.test', async () => new Response('not found', { status: 404 }));

  await assert.rejects(client.getHistory('conv 1'), /Conversation history request failed with 404/);
});
