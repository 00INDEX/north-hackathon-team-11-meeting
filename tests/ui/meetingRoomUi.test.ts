import { describe, expect, it } from 'vitest';
import { renderMeetingRoomApp } from '@/ui/meetingRoomUi';

describe('RFC-0001 T5 meeting room UI', () => {
  it('renders the list, availability, calendar, reservation, management, and force-adjust surfaces', () => {
    const html = renderMeetingRoomApp();

    expect(html).toContain('data-testid="room-list"');
    expect(html).toContain('data-testid="availability-query"');
    expect(html).toContain('data-testid="calendar-view"');
    expect(html).toContain('data-testid="reservation-actions"');
    expect(html).toContain('data-testid="room-management"');
    expect(html).toContain('data-testid="rule-management"');
    expect(html).toContain('data-testid="force-adjust-confirm"');
    expect(html).toContain('data-testid="force-adjust-preview"');
  });

  it('includes client-side API flows for booking, conflict display, cancellation, and force adjustment', () => {
    const html = renderMeetingRoomApp();

    expect(html).toContain("requestJson('/api/availability");
    expect(html).toContain("requestJson('/api/reservations");
    expect(html).toContain("requestJson('/api/rooms/");
    expect(html).toContain("requestJson('/api/rules");
    expect(html).toContain("/cancel");
    expect(html).toContain("/force-adjust");
    expect(html).toContain('error.conflicts');
    expect(html).toContain('冲突详情');
    expect(html).toContain('将取消以下预约');
  });

  it('marks reservations and rule blocks with distinct visual states', () => {
    const html = renderMeetingRoomApp();

    expect(html).toContain('badge.active');
    expect(html).toContain('badge.blocked');
    expect(html).toContain('badge.cancelled');
    expect(html).toContain('event.reservation');
    expect(html).toContain('event.block');
  });
});
