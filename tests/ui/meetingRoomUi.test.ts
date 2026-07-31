import { describe, expect, it } from "vitest";

import { renderMeetingRoomApp } from "../../src/ui/meetingRoomUi";

describe("meeting room UI shell", () => {
  it("renders the d1291f8 three-panel dashboard with RFC-0004 real Agent flow", () => {
    const html = renderMeetingRoomApp();
    const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? "";

    expect(html).toContain("<title>会务 Agent - 会议室管理系统</title>");
    expect(html).toContain('class="top-nav"');
    expect(html).toContain('class="main-content"');
    expect(html).toContain('class="panel-left"');
    expect(html).toContain('class="panel-center"');
    expect(html).toContain('class="panel-right"');
    expect(html).toContain('id="time-grid"');
    expect(html).toContain('class="floor-plan"');
    expect(html).toContain('class="rule-list"');
    expect(html).toContain('data-testid="agent-chat-panel"');
    expect(html).toContain('id="agent-session"');
    expect(html).toContain('id="agent-messages"');
    expect(html).toContain('id="agent-form"');
    expect(html).toContain('id="agent-input"');
    expect(html).toContain('id="agent-send"');

    expect(script).toContain("fetchJson('/api/rooms'");
    expect(script).toContain("fetchJson('/api/rules'");
    expect(script).toContain("fetchJson('/api/reservations?from=");
    expect(script).toContain("fetch('/api/agent/message'");
    expect(script).toContain("method: 'POST'");
    expect(script).toContain("conversationId: agentConversationId");
    expect(script).toContain("requestId: idempotencyKey('agent-message')");
    expect(script).toContain("localStorage.getItem(AGENT_CONVERSATION_STORAGE_KEY)");
    expect(script).toContain("localStorage.setItem(AGENT_CONVERSATION_STORAGE_KEY, created)");
    expect(script).toContain("parsedIntent: options.parsedIntent ?? null");
    expect(script).toContain("Agent 服务返回了无法识别的响应");
    expect(script).toContain("无法连接 Agent 服务");
    expect(script).toContain("loadRooms(),");
    expect(script).toContain("loadRules(),");
    expect(script).toContain("loadCalendar(),");
    expect(script).toContain("AGENT_MUTATION_ACTIONS.has(action.type)");
  });
});
