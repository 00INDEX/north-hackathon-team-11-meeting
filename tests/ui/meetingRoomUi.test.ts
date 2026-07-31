import { Script } from "node:vm";
import { describe, expect, it } from "vitest";
import { renderMeetingRoomApp } from "@/ui/meetingRoomUi";

describe("RFC-0001 T5 meeting room UI", () => {
  it("renders the list, availability, calendar, reservation, management, and force-adjust surfaces", () => {
    const html = renderMeetingRoomApp();

    expect(html).toContain('data-testid="room-list"');
    expect(html).toContain('data-testid="availability-query"');
    expect(html).toContain('data-testid="calendar-view"');
    expect(html).toContain('data-testid="reservation-actions"');
    expect(html).toContain('data-testid="room-management"');
    expect(html).toContain('data-testid="rule-management"');
    expect(html).toContain('data-testid="rule-list"');
    expect(html).toContain('id="rules-body"');
    expect(html).toContain('data-testid="force-adjust-confirm"');
    expect(html).toContain('data-testid="force-adjust-preview"');
  });

  it("includes client-side API flows for booking, conflict display, cancellation, and force adjustment", () => {
    const html = renderMeetingRoomApp();

    expect(html).toContain("requestJson('/api/availability");
    expect(html).toContain("requestJson('/api/reservations");
    expect(html).toContain("requestJson('/api/rooms/");
    expect(html).toContain("requestJson('/api/rules");
    expect(html).toContain("/cancel");
    expect(html).toContain("/force-adjust");
    expect(html).toContain("error.conflicts");
    expect(html).toContain("冲突详情");
    expect(html).toContain("将取消以下预约");
  });

  it("marks reservations and rule blocks with distinct visual states", () => {
    const html = renderMeetingRoomApp();

    expect(html).toContain("badge.active");
    expect(html).toContain("badge.blocked");
    expect(html).toContain("badge.cancelled");
    expect(html).toContain("event.reservation");
    expect(html).toContain("event.block");
  });

  it("keeps every management surface while adding the in-page Agent chat panel", () => {
    const html = renderMeetingRoomApp();

    expect(html).toContain('data-testid="agent-chat-panel"');
    expect(html).toContain('data-testid="agent-message-list"');
    expect(html).toContain('data-testid="agent-message-form"');
    expect(html).toContain('id="agent-input"');
    expect(html).toContain('id="agent-send"');
    expect(html).toContain("会议副驾");
    expect(html).toContain("Enter 发送 · Shift + Enter 换行");

    expect(html).toContain('data-testid="availability-query"');
    expect(html).toContain('data-testid="reservation-actions"');
    expect(html).toContain('data-testid="room-list"');
    expect(html).toContain('data-testid="rule-management"');
  });

  it("persists a stable conversation ID and sends only the public Agent request fields", () => {
    const html = renderMeetingRoomApp();
    const payloadBuilder = html.slice(
      html.indexOf("function buildAgentMessagePayload"),
      html.indexOf("async function requestAgentMessage"),
    );

    expect(html).toContain(
      "const AGENT_CONVERSATION_STORAGE_KEY = 'meeting-room-agent-conversation-id'",
    );
    expect(html).toContain(
      "localStorage.getItem(AGENT_CONVERSATION_STORAGE_KEY)",
    );
    expect(html).toContain(
      "localStorage.setItem(AGENT_CONVERSATION_STORAGE_KEY, created)",
    );
    expect(html).toContain("fetch('/api/agent/message'");
    expect(payloadBuilder).toContain(
      "conversationId: state.agentConversationId",
    );
    expect(payloadBuilder).toContain("message,");
    expect(payloadBuilder).toContain(
      "requestId: idempotencyKey('agent-message')",
    );
    expect(payloadBuilder).not.toContain("userId");
    expect(payloadBuilder).not.toContain("role");
    expect(payloadBuilder).not.toContain("authContext");
    expect(payloadBuilder).not.toContain("history");
  });

  it("supports keyboard sending, loading state, structured debug details, and clear transport errors", () => {
    const html = renderMeetingRoomApp();

    expect(html).toContain(
      "event.key !== 'Enter' || event.shiftKey || event.isComposing",
    );
    expect(html).toContain("$('#agent-form').requestSubmit()");
    expect(html).toContain(
      "button.textContent = isLoading ? '处理中…' : '发送'",
    );
    expect(html).toContain("setAttribute('aria-busy', String(isLoading))");
    expect(html).toContain("className = 'agent-debug'");
    expect(html).toContain("parsedIntent: options.parsedIntent ?? null");
    expect(html).toContain("actions,");
    expect(html).toContain("Agent 服务返回了无法识别的响应");
    expect(html).toContain("'Agent 请求失败（HTTP ' + response.status");
    expect(html).toContain("无法连接 Agent 服务");
  });

  it("refreshes authoritative views after a successful Agent mutation and remains responsive", () => {
    const html = renderMeetingRoomApp();

    expect(html).toContain(
      "action.status === 'completed' && AGENT_MUTATION_ACTIONS.has(action.type)",
    );
    expect(html).toContain("loadRooms(),");
    expect(html).toContain("loadReservations(),");
    expect(html).toContain("loadRules(),");
    expect(html).toContain("loadCalendar(),");
    expect(html).toContain("@media (max-width: 1180px)");
    expect(html).toContain(".agent-panel { position: static; order: -1; }");
    expect(html).toContain("@media (max-width: 760px)");
  });

  it("emits syntactically valid browser JavaScript", () => {
    const html = renderMeetingRoomApp();
    const script = html.match(
      /<script type="module">([\s\S]*?)<\/script>/,
    )?.[1];

    expect(script).toBeDefined();
    if (!script) {
      throw new Error("Expected the rendered page to contain a module script.");
    }
    expect(() => new Script(script)).not.toThrow();
  });
});
