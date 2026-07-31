/**
 * Web UI for RFC-0001 T5.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * Renders a small self-contained management page that exercises the local room booking API.
 */
export function renderMeetingRoomApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>本地会议室查询与预订系统</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
        background: #f6f7fb;
        color: #172033;
      }
      * { box-sizing: border-box; }
      body { margin: 0; }
      header {
        background: linear-gradient(135deg, #1f4fd8, #5b7cfa);
        color: #fff;
        padding: 28px 32px;
      }
      header h1 { margin: 0 0 8px; font-size: 26px; }
      header p { margin: 0; opacity: 0.86; }
      main { padding: 24px; display: grid; gap: 20px; max-width: 1440px; margin: 0 auto; }
      section, .panel {
        background: #fff;
        border: 1px solid #e5e9f2;
        border-radius: 16px;
        box-shadow: 0 8px 24px rgba(24, 39, 75, 0.06);
        padding: 20px;
      }
      h2 { margin: 0 0 16px; font-size: 20px; }
      h3 { margin: 0 0 12px; font-size: 16px; }
      .toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; }
      .field { display: grid; gap: 6px; }
      label { color: #59637a; font-size: 13px; }
      input, select, textarea {
        border: 1px solid #d8deea;
        border-radius: 10px;
        padding: 9px 10px;
        font: inherit;
        min-width: 150px;
      }
      textarea { min-height: 74px; resize: vertical; }
      button {
        border: 0;
        border-radius: 10px;
        padding: 9px 14px;
        background: #1f4fd8;
        color: #fff;
        font-weight: 600;
        cursor: pointer;
      }
      button.secondary { background: #eef2ff; color: #1f4fd8; border: 1px solid #cfd8ff; }
      button.danger { background: #d92d20; }
      button:disabled { opacity: 0.55; cursor: not-allowed; }
      .grid { display: grid; gap: 16px; }
      .grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      table { width: 100%; border-collapse: collapse; }
      th, td { border-bottom: 1px solid #e8ecf4; padding: 10px; text-align: left; vertical-align: top; }
      th { color: #59637a; font-size: 13px; }
      .badge {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 3px 8px;
        font-size: 12px;
        font-weight: 700;
      }
      .badge.active { background: #dcfce7; color: #15803d; }
      .badge.blocked { background: #fee2e2; color: #b91c1c; }
      .badge.cancelled { background: #f1f5f9; color: #475569; }
      .badge.available { background: #dbeafe; color: #1d4ed8; }
      .notice, .conflicts {
        border-radius: 12px;
        padding: 12px;
        margin: 12px 0;
        border: 1px solid #d8deea;
        background: #f8fafc;
        white-space: pre-wrap;
      }
      .conflicts { border-color: #fecaca; background: #fff7f7; }
      .calendar { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 8px; }
      .day { border: 1px solid #e5e9f2; border-radius: 14px; min-height: 150px; padding: 10px; background: #fbfcff; }
      .day-header { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 8px; }
      .event { border-radius: 8px; padding: 5px 7px; margin: 4px 0; font-size: 12px; }
      .event.reservation { background: #dbeafe; color: #1e3a8a; }
      .event.block { background: #fee2e2; color: #991b1b; }
      .muted { color: #6b7280; font-size: 13px; }
      .actions { display: flex; flex-wrap: wrap; gap: 8px; }
      @media (max-width: 1000px) { .grid.two, .grid.three { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <header>
      <h1>本地会议室查询与预订系统</h1>
      <p>RFC-0001 T5：列表、日历、可用性查询、预约与强制调整管理界面</p>
    </header>
    <main>
      <section class="grid two" aria-labelledby="availability-title">
        <div>
          <h2 id="availability-title">可用性查询</h2>
          <form id="availability-form" data-testid="availability-query" class="toolbar">
            <div class="field">
              <label for="availability-start">开始时间</label>
              <input id="availability-start" name="start" type="datetime-local" required>
            </div>
            <div class="field">
              <label for="availability-end">结束时间</label>
              <input id="availability-end" name="end" type="datetime-local" required>
            </div>
            <div class="field">
              <label for="availability-capacity">最小容量</label>
              <input id="availability-capacity" name="capacity" type="number" min="1" step="1" placeholder="例如 10">
            </div>
            <div class="field">
              <label for="availability-equipment">设备</label>
              <input id="availability-equipment" name="equipment" type="text" placeholder="例如 projector">
            </div>
            <button type="submit">查询可订房间</button>
          </form>
          <div id="availability-message" class="notice" data-testid="availability-message" hidden></div>
          <div id="availability-results" data-testid="availability-results"></div>
        </div>
        <div>
          <h2 id="booking-title">创建预约</h2>
          <form id="reservation-form" data-testid="reservation-actions" class="grid">
            <div class="field">
              <label for="reservation-room">房间</label>
              <select id="reservation-room" name="roomId" required><option value="">选择房间</option></select>
            </div>
            <div class="field">
              <label for="reservation-title">标题</label>
              <input id="reservation-title" name="title" required placeholder="例如 产品评审">
            </div>
            <div class="field">
              <label for="reservation-start">开始时间</label>
              <input id="reservation-start" name="start" type="datetime-local" required>
            </div>
            <div class="field">
              <label for="reservation-end">结束时间</label>
              <input id="reservation-end" name="end" type="datetime-local" required>
            </div>
            <div class="field">
              <label for="reservation-description">说明</label>
              <textarea id="reservation-description" name="description" placeholder="选填"></textarea>
            </div>
            <button type="submit">提交预约</button>
          </form>
          <div id="reservation-message" class="notice" hidden></div>
        </div>
      </section>

      <section aria-labelledby="rooms-title">
        <h2 id="rooms-title">会议室列表</h2>
        <div class="actions" style="margin-bottom: 12px;">
          <button id="refresh-rooms" class="secondary" type="button">刷新房间</button>
        </div>
        <table data-testid="room-list">
          <thead><tr><th>状态</th><th>房间</th><th>容量</th><th>位置</th><th>开放时段</th><th>资源</th><th>操作</th></tr></thead>
          <tbody id="rooms-body"></tbody>
        </table>
      </section>

      <section aria-labelledby="calendar-title">
        <h2 id="calendar-title">日/周日历</h2>
        <div class="toolbar" style="margin-bottom: 12px;">
          <div class="field"><label for="calendar-room">房间</label><select id="calendar-room"><option value="">选择房间</option></select></div>
          <div class="field"><label for="calendar-date">日期</label><input id="calendar-date" type="date" required></div>
          <button id="calendar-day" class="secondary" type="button">日视图</button>
          <button id="calendar-week" class="secondary" type="button">周视图</button>
          <button id="calendar-refresh" class="secondary" type="button">刷新日历</button>
        </div>
        <div id="calendar-view" data-testid="calendar-view"></div>
      </section>

      <section aria-labelledby="reservations-title">
        <h2 id="reservations-title">预约管理</h2>
        <div class="toolbar" style="margin-bottom: 12px;">
          <div class="field"><label for="reservations-room">房间</label><select id="reservations-room"><option value="">全部房间</option></select></div>
          <div class="field"><label for="reservations-from">开始</label><input id="reservations-from" type="date"></div>
          <div class="field"><label for="reservations-to">结束</label><input id="reservations-to" type="date"></div>
          <button id="reservations-refresh" class="secondary" type="button">刷新预约</button>
        </div>
        <table data-testid="reservations-table">
          <thead><tr><th>状态</th><th>预约</th><th>房间</th><th>时间</th><th>操作</th></tr></thead>
          <tbody id="reservations-body"></tbody>
        </table>
      </section>

      <section class="grid two" aria-labelledby="admin-title">
        <div>
          <h2 id="admin-title">房间管理</h2>
          <form id="room-form" data-testid="room-management" class="grid">
            <input type="hidden" name="id">
            <input type="hidden" name="version">
            <div class="grid two">
              <div class="field"><label for="room-name">名称</label><input id="room-name" name="name" required></div>
              <div class="field"><label for="room-type">类型</label><input id="room-type" name="type" required></div>
              <div class="field"><label for="room-capacity">容量</label><input id="room-capacity" name="capacity" type="number" min="1" required></div>
              <div class="field"><label for="room-location">位置</label><input id="room-location" name="location" required></div>
              <div class="field"><label for="room-equipment">设备</label><input id="room-equipment" name="equipment" placeholder="逗号分隔"></div>
              <div class="field"><label for="room-open-start">开放开始</label><input id="room-open-start" name="openStart" type="time" required></div>
              <div class="field"><label for="room-open-end">开放结束</label><input id="room-open-end" name="openEnd" type="time" required></div>
              <div class="field"><label for="room-enabled">启用</label><select id="room-enabled" name="enabled"><option value="true">启用</option><option value="false">禁用</option></select></div>
            </div>
            <button type="submit">保存房间</button>
          </form>
          <div id="room-message" class="notice" hidden></div>
        </div>
        <div>
          <h2 id="rules-title">规则管理</h2>
          <form id="rule-form" data-testid="rule-management" class="grid">
            <input type="hidden" name="id">
            <input type="hidden" name="version">
            <div class="field"><label for="rule-target-type">目标类型</label><select id="rule-target-type" name="targetType"><option value="room">room</option><option value="resource">resource</option></select></div>
            <div class="field"><label for="rule-target-id">目标 ID</label><input id="rule-target-id" name="targetId" required></div>
            <div class="field"><label for="rule-type">规则类型</label><select id="rule-type" name="ruleType"><option value="one_time_block">one_time_block</option><option value="periodic_block">periodic_block</option></select></div>
            <div class="field"><label for="rule-reason">原因</label><input id="rule-reason" name="reason" required></div>
            <div class="field"><label for="rule-start">开始 UTC</label><input id="rule-start" name="start" type="datetime-local" required></div>
            <div class="field"><label for="rule-end">结束 UTC</label><input id="rule-end" name="end" type="datetime-local" required></div>
            <div class="field"><label for="rule-enabled">启用</label><select id="rule-enabled" name="enabled"><option value="true">启用</option><option value="false">停用</option></select></div>
            <button type="submit">保存规则</button>
          </form>
          <div id="rule-message" class="notice" hidden></div>
        </div>
      </section>

      <section aria-labelledby="force-title">
        <h2 id="force-title">强制调整</h2>
        <form id="force-adjust-form" data-testid="force-adjust-confirm" class="toolbar">
          <div class="field"><label for="force-reservation">预约 ID</label><input id="force-reservation" name="reservationId" required placeholder="reservation-*"></div>
          <div class="field"><label for="force-room">调整到房间</label><select id="force-room" name="roomId" required><option value="">选择房间</option></select></div>
          <div class="field"><label for="force-start">开始时间</label><input id="force-start" name="start" type="datetime-local" required></div>
          <div class="field"><label for="force-end">结束时间</label><input id="force-end" name="end" type="datetime-local" required></div>
          <div class="field"><label for="force-reason">原因</label><input id="force-reason" name="reason" required placeholder="例如 客户临时到访"></div>
          <button id="force-preview" class="secondary" type="button">预览将取消的预约</button>
          <button type="submit">确认强制调整</button>
        </form>
        <div id="force-preview-area" data-testid="force-adjust-preview" class="conflicts" hidden></div>
        <div id="force-message" class="notice" hidden></div>
      </section>
    </main>
    <script type="module">
      const state = { rooms: [], rules: [], reservations: [], calendarView: 'week', forcePreview: [] };
      const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
      const $ = (selector) => document.querySelector(selector);
      const text = (selector, value) => { const node = $(selector); node.textContent = value; };
      const html = (selector, value) => { const node = $(selector); node.innerHTML = value; };

      function pad(value) { return String(value).padStart(2, '0'); }
      function toLocalInputValue(iso) {
        if (!iso) return '';
        const date = new Date(iso);
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
        return local.toISOString().slice(0, 16);
      }
      function toUtcInputValue(iso) {
        if (!iso) return '';
        return new Date(iso).toISOString().slice(0, 16);
      }
      function toUtcISOString(localValue) {
        return new Date(localValue).toISOString();
      }
      function localDateInput(date) {
        return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
      }
      function addLocalDays(dateKey, days) {
        const [year, month, day] = dateKey.split('-').map(Number);
        const date = new Date(year, month - 1, day);
        date.setDate(date.getDate() + days);
        return localDateInput(date);
      }
      function localDayBounds(dateKey) {
        const [year, month, day] = dateKey.split('-').map(Number);
        const start = new Date(Date.UTC(year, month - 1, day) - SHANGHAI_OFFSET_MS);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      function formatDate(iso) {
        return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
      }
      function formatTime(iso) {
        return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
      }
      function escapeHtml(value) {
        return String(value ?? '')
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#039;');
      }
      function badge(status) {
        const normalized = status === true ? 'enabled' : String(status ?? '');
        if (normalized === 'active' || normalized === 'enabled' || normalized === 'available') return '<span class="badge active">可用/启用</span>';
        if (normalized === 'cancelled' || normalized === 'disabled') return '<span class="badge cancelled">已取消/禁用</span>';
        if (normalized === 'blocked') return '<span class="badge blocked">禁用</span>';
        return '<span class="badge available">' + escapeHtml(normalized) + '</span>';
      }
      function showMessage(selector, message, isError = false) {
        const node = $(selector);
        node.hidden = !message;
        node.className = isError ? 'notice conflicts' : 'notice';
        node.textContent = message || '';
      }
      async function requestJson(url, options = {}) {
        const response = await fetch(url, {
          headers: { 'content-type': 'application/json', ...options.headers },
          ...options,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = body.error ?? { code: 'REQUEST_FAILED', message: response.statusText };
          throw Object.assign(new Error(error.message), { status: response.status, code: error.code, conflicts: error.conflicts ?? [] });
        }
        return body;
      }
      function conflictText(conflict) {
        const room = conflict.room ?? conflict.roomName ?? conflict.name ?? conflict.id ?? '未知房间';
        const start = conflict.start ? formatDate(conflict.start) : '未知开始时间';
        const end = conflict.end ? formatDate(conflict.end) : '未知结束时间';
        const reason = conflict.reason ?? conflict.type ?? '原因未知';
        return room + ' ' + start + '–' + end + '：' + reason;
      }
      function renderConflicts(error) {
        const conflicts = error.conflicts ?? [];
        if (conflicts.length === 0) return '错误：' + error.message;
        return error.message + '\\n冲突详情：\\n' + conflicts.map(conflictText).join('\\n');
      }
      function roomName(roomId) {
        return (state.rooms.find((room) => room.id === roomId)?.name) ?? roomId;
      }
      function fillSelect(selector, items, emptyLabel, valueKey = 'id', labelKey = 'name') {
        const node = $(selector);
        node.innerHTML = '<option value="">' + escapeHtml(emptyLabel) + '</option>' + items.map((item) =>
          '<option value="' + escapeHtml(item[valueKey]) + '">' + escapeHtml(item[labelKey]) + '</option>',
        ).join('');
      }
      function parseEquipment(value) {
        return value.split(',').map((item) => item.trim()).filter(Boolean);
      }
      function idempotencyKey(prefix) {
        return prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
      }

      async function loadRooms() {
        const rooms = await requestJson('/api/rooms');
        state.rooms = rooms;
        fillSelect('#reservation-room', rooms, '选择房间');
        fillSelect('#calendar-room', rooms, '选择房间');
        fillSelect('#reservations-room', rooms, '全部房间');
        fillSelect('#force-room', rooms, '选择房间');
        renderRooms(rooms);
        return rooms;
      }
      function renderRooms(rooms) {
        const body = $('#rooms-body');
        body.innerHTML = rooms.map((room) => {
          const resources = (room.resources ?? []).map((resource) => resource.name ?? resource.id).join(', ') || '无';
          return '<tr>' +
            '<td>' + badge(room.enabled ? 'enabled' : 'disabled') + '</td>' +
            '<td><strong>' + escapeHtml(room.name) + '</strong><br><span class="muted">' + escapeHtml(room.id) + '</span></td>' +
            '<td>' + room.capacity + '</td>' +
            '<td>' + escapeHtml(room.location) + '</td>' +
            '<td>' + escapeHtml(room.openStart) + '–' + escapeHtml(room.openEnd) + '</td>' +
            '<td>' + escapeHtml(resources) + '</td>' +
            '<td><button class="secondary room-edit" data-room-id="' + escapeHtml(room.id) + '" type="button">编辑</button></td>' +
          '</tr>';
        }).join('');
        document.querySelectorAll('.room-edit').forEach((button) => {
          button.addEventListener('click', () => editRoom(button.dataset.roomId));
        });
      }

      async function loadAvailability(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const start = toUtcISOString(form.start.value);
        const end = toUtcISOString(form.end.value);
        const params = new URLSearchParams({ start, end });
        if (form.capacity.value) params.set('capacity', form.capacity.value);
        if (form.equipment.value) params.set('equipment', form.equipment.value);
        try {
          const rooms = await requestJson('/api/availability?' + params.toString());
          html('#availability-results', renderAvailabilityRooms(rooms));
          showMessage('#availability-message', '找到 ' + rooms.length + ' 个可用房间。点击“预订”会把时间填入创建预约表单。');
        } catch (error) {
          html('#availability-results', '');
          showMessage('#availability-message', renderConflicts(error), true);
        }
      }
      function renderAvailabilityRooms(rooms) {
        if (rooms.length === 0) return '<p class="muted">当前查询条件没有可用房间。</p>';
        return '<table><thead><tr><th>房间</th><th>容量</th><th>位置</th><th>设备</th><th>操作</th></tr></thead><tbody>' +
          rooms.map((room) => '<tr>' +
            '<td><strong>' + escapeHtml(room.name) + '</strong><br><span class="muted">' + escapeHtml(room.id) + '</span></td>' +
            '<td>' + room.capacity + '</td>' +
            '<td>' + escapeHtml(room.location) + '</td>' +
            '<td>' + escapeHtml((room.equipment ?? []).join(', ')) + '</td>' +
            '<td><button class="book-from-result" data-room-id="' + escapeHtml(room.id) + '" type="button">预订</button></td>' +
          '</tr>').join('') + '</tbody></table>';
      }

      async function createReservation(event) {
        event.preventDefault();
        const form = event.currentTarget;
        try {
          const reservation = await requestJson('/api/reservations', {
            method: 'POST',
            headers: { 'x-actor': 'web-user', 'x-idempotency-key': idempotencyKey('web-reservation') },
            body: JSON.stringify({
              title: form.title.value,
              roomId: form.roomId.value,
              start: toUtcISOString(form.start.value),
              end: toUtcISOString(form.end.value),
              description: form.description.value,
            }),
          });
          showMessage('#reservation-message', '预约已创建：' + reservation.id);
          form.reset();
          await Promise.allSettled([loadReservations(), loadCalendar()]);
        } catch (error) {
          showMessage('#reservation-message', renderConflicts(error), true);
        }
      }

      async function loadCalendar() {
        const roomId = $('#calendar-room').value;
        const date = $('#calendar-date').value || localDateInput(new Date());
        $('#calendar-date').value = date;
        if (!roomId) {
          html('#calendar-view', '<p class="muted">请选择房间后加载日历。日历会同时展示预约状态和禁用/规则阻塞状态。</p>');
          return;
        }
        const { start, end } = state.calendarView === 'week'
          ? { start: localDayBounds(addLocalDays(date, -getWeekOffset(date))).start, end: localDayBounds(addLocalDays(date, 7)).end }
          : localDayBounds(date);
        const calendar = await requestJson('/api/rooms/' + encodeURIComponent(roomId) + '/calendar?from=' + encodeURIComponent(start) + '&to=' + encodeURIComponent(end));
        renderCalendar(date, calendar);
      }
      function getWeekOffset(dateKey) {
        const [year, month, day] = dateKey.split('-').map(Number);
        return new Date(year, month - 1, day).getDay();
      }
      function renderCalendar(anchorDate, calendar) {
        const days = state.calendarView === 'week'
          ? Array.from({ length: 7 }, (_, index) => addLocalDays(anchorDate, index - getWeekOffset(anchorDate)))
          : [anchorDate];
        html('#calendar-view', days.map((dateKey) => {
          const dayStart = localDayBounds(dateKey).start;
          const dayEnd = localDayBounds(addLocalDays(dateKey, 1)).start;
          const reservations = (calendar.reservations ?? []).filter((item) => item.start < dayEnd && item.end > dayStart);
          const blocks = (calendar.blocks ?? []).filter((item) => item.start < dayEnd && item.end > dayStart);
          const items = [
            ...reservations.map((item) => ({ kind: 'reservation', label: item.title, start: item.start, end: item.end, reason: item.status })),
            ...blocks.map((item) => ({ kind: 'block', label: item.reason ?? item.ruleId ?? '禁用', start: item.start, end: item.end, reason: item.reason ?? '规则禁用' })),
          ].sort((left, right) => left.start.localeCompare(right.start));
          return '<div class="day"><div class="day-header"><strong>' + escapeHtml(dateKey) + '</strong><span>' + items.length + '</span></div>' +
            (items.length ? items.map((item) => '<div class="event ' + escapeHtml(item.kind) + '"><strong>' + escapeHtml(item.label) + '</strong><br>' + escapeHtml(formatTime(item.start)) + '–' + escapeHtml(formatTime(item.end)) + '<br><span class="muted">' + escapeHtml(item.reason) + '</span></div>').join('') : '<span class="muted">无预约/禁用</span>') +
          '</div>';
        }).join(''));
      }

      async function loadReservations() {
        const params = new URLSearchParams();
        const roomId = $('#reservations-room').value;
        const from = $('#reservations-from').value;
        const to = $('#reservations-to').value;
        if (roomId) params.set('roomId', roomId);
        if (from) params.set('from', new Date(from).toISOString());
        if (to) params.set('to', new Date(to + 'T23:59:59').toISOString());
        const reservations = await requestJson('/api/reservations?' + params.toString());
        state.reservations = reservations;
        renderReservations(reservations);
      }
      function renderReservations(reservations) {
        const body = $('#reservations-body');
        body.innerHTML = reservations.map((reservation) => '<tr>' +
          '<td>' + badge(reservation.status) + '</td>' +
          '<td><strong>' + escapeHtml(reservation.title) + '</strong><br><span class="muted">' + escapeHtml(reservation.id) + '</span></td>' +
          '<td>' + escapeHtml(roomName(reservation.roomId)) + '</td>' +
          '<td>' + escapeHtml(formatDate(reservation.start)) + '–' + escapeHtml(formatDate(reservation.end)) + '</td>' +
          '<td><div class="actions">' +
            '<button class="secondary reservation-edit" data-reservation-id="' + escapeHtml(reservation.id) + '" type="button">修改</button>' +
            '<button class="danger reservation-cancel" data-reservation-id="' + escapeHtml(reservation.id) + '" type="button">取消</button>' +
          '</div></td>' +
        '</tr>').join('') || '<tr><td colspan="5" class="muted">暂无预约。</td></tr>';
        document.querySelectorAll('.reservation-edit').forEach((button) => {
          button.addEventListener('click', () => editReservation(button.dataset.reservationId));
        });
        document.querySelectorAll('.reservation-cancel').forEach((button) => {
          button.addEventListener('click', () => cancelReservation(button.dataset.reservationId));
        });
      }
      function editReservation(id) {
        const reservation = state.reservations.find((item) => item.id === id);
        if (!reservation) return;
        $('#reservation-room').value = reservation.roomId;
        $('#reservation-title').value = reservation.title;
        $('#reservation-start').value = toLocalInputValue(reservation.start);
        $('#reservation-end').value = toLocalInputValue(reservation.end);
        $('#reservation-description').value = reservation.description ?? '';
        $('#reservation-form').dataset.editId = id;
        $('#reservation-form').dataset.version = reservation.version;
        $('#reservation-message').hidden = true;
      }
      async function cancelReservation(id) {
        const reservation = state.reservations.find((item) => item.id === id);
        const reason = window.prompt('取消原因', reservation?.title + ' 取消');
        if (reason === null) return;
        try {
          await requestJson('/api/reservations/' + encodeURIComponent(id) + '/cancel', {
            method: 'POST',
            headers: { 'x-actor': 'web-user', 'x-reason': reason },
            body: JSON.stringify({ reason }),
          });
          await loadReservations();
          await loadCalendar();
        } catch (error) {
          showMessage('#reservation-message', renderConflicts(error), true);
        }
      }

      async function saveRoom(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const body = {
          name: form.name.value,
          type: form.type.value,
          capacity: Number(form.capacity.value),
          location: form.location.value,
          equipment: parseEquipment(form.equipment.value),
          enabled: form.enabled.value === 'true',
          openStart: form.openStart.value,
          openEnd: form.openEnd.value,
          version: form.version.value ? Number(form.version.value) : undefined,
        };
        try {
          const room = form.id.value
            ? await requestJson('/api/rooms/' + encodeURIComponent(form.id.value), { method: 'PATCH', headers: { 'x-actor': 'admin' }, body: JSON.stringify(body) })
            : await requestJson('/api/rooms', { method: 'POST', headers: { 'x-actor': 'admin', 'x-idempotency-key': idempotencyKey('room') }, body: JSON.stringify(body) });
          showMessage('#room-message', '房间已保存：' + room.id);
          form.reset();
          form.id.value = '';
          form.version.value = '';
          await loadRooms();
        } catch (error) {
          showMessage('#room-message', renderConflicts(error), true);
        }
      }
      function editRoom(id) {
        const room = state.rooms.find((item) => item.id === id);
        if (!room) return;
        const form = $('#room-form');
        form.id.value = room.id;
        form.version.value = room.version;
        form.name.value = room.name;
        form.type.value = room.type;
        form.capacity.value = room.capacity;
        form.location.value = room.location;
        form.equipment.value = (room.equipment ?? []).join(', ');
        form.openStart.value = room.openStart;
        form.openEnd.value = room.openEnd;
        form.enabled.value = room.enabled ? 'true' : 'false';
      }

      async function saveRule(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const body = {
          targetType: form.targetType.value,
          targetId: form.targetId.value,
          ruleType: form.ruleType.value,
          reason: form.reason.value,
          enabled: form.enabled.value === 'true',
          start: toUtcISOString(form.start.value),
          end: toUtcISOString(form.end.value),
          version: form.version.value ? Number(form.version.value) : undefined,
        };
        if (form.ruleType.value === 'periodic_block') {
          body.recurrence = JSON.stringify({ type: 'weekly', weekdays: [1, 2, 3, 4, 5], timeStart: form.start.value.slice(11, 16), timeEnd: form.end.value.slice(11, 16) });
        }
        try {
          const rule = form.id.value
            ? await requestJson('/api/rules/' + encodeURIComponent(form.id.value), { method: 'PATCH', headers: { 'x-actor': 'admin' }, body: JSON.stringify(body) })
            : await requestJson('/api/rules', { method: 'POST', headers: { 'x-actor': 'admin', 'x-idempotency-key': idempotencyKey('rule') }, body: JSON.stringify(body) });
          showMessage('#rule-message', '规则已保存：' + rule.id);
          form.reset();
          form.id.value = '';
          form.version.value = '';
          await loadRules();
          await loadCalendar();
        } catch (error) {
          showMessage('#rule-message', renderConflicts(error), true);
        }
      }
      async function loadRules() {
        const rules = await requestJson('/api/rules');
        state.rules = rules;
        const body = $('#rules-body');
        body.innerHTML = rules.map((rule) => '<tr>' +
          '<td>' + badge(rule.enabled ? 'enabled' : 'disabled') + '</td>' +
          '<td>' + escapeHtml(rule.id) + '</td>' +
          '<td>' + escapeHtml(rule.targetType) + ' / ' + escapeHtml(rule.targetId) + '</td>' +
          '<td>' + escapeHtml(rule.ruleType) + '</td>' +
          '<td>' + escapeHtml(rule.reason) + '</td>' +
          '<td>' + escapeHtml(rule.start) + '–' + escapeHtml(rule.end) + '</td>' +
          '<td><div class="actions"><button class="secondary rule-edit" data-rule-id="' + escapeHtml(rule.id) + '" type="button">编辑</button>' +
            (rule.isSystem ? '' : '<button class="danger rule-delete" data-rule-id="' + escapeHtml(rule.id) + '" type="button">删除</button>') +
          '</div></td>' +
        '</tr>').join('');
        document.querySelectorAll('.rule-edit').forEach((button) => button.addEventListener('click', () => editRule(button.dataset.ruleId)));
        document.querySelectorAll('.rule-delete').forEach((button) => button.addEventListener('click', () => deleteRule(button.dataset.ruleId)));
      }
      function editRule(id) {
        const rule = state.rules.find((item) => item.id === id);
        if (!rule) return;
        const form = $('#rule-form');
        form.id.value = rule.id;
        form.version.value = rule.version;
        form.targetType.value = rule.targetType;
        form.targetId.value = rule.targetId;
        form.ruleType.value = rule.ruleType;
        form.reason.value = rule.reason;
        form.start.value = toUtcInputValue(rule.start);
        form.end.value = toUtcInputValue(rule.end);
        form.enabled.value = rule.enabled ? 'true' : 'false';
      }
      async function deleteRule(id) {
        if (!window.confirm('确认删除规则 ' + id + '？系统规则不可物理删除。')) return;
        try {
          await requestJson('/api/rules/' + encodeURIComponent(id), { method: 'DELETE', headers: { 'x-actor': 'admin' } });
          await loadRules();
          await loadCalendar();
        } catch (error) {
          showMessage('#rule-message', renderConflicts(error), true);
        }
      }

      async function previewForceAdjustment() {
        const form = $('#force-adjust-form');
        const roomId = form.roomId.value;
        const start = toUtcISOString(form.start.value);
        const end = toUtcISOString(form.end.value);
        const reservations = await requestJson('/api/reservations?roomId=' + encodeURIComponent(roomId) + '&from=' + encodeURIComponent(start) + '&to=' + encodeURIComponent(end));
        const active = reservations.filter((reservation) => reservation.status === 'active');
        state.forcePreview = active.map((reservation) => ({
          id: reservation.id,
          room: roomName(reservation.roomId),
          start: reservation.start,
          end: reservation.end,
          reason: '目标房间/时段已有有效预约，强制调整会取消该预约',
        }));
        renderForcePreview();
      }
      function renderForcePreview() {
        const node = $('#force-preview-area');
        node.hidden = state.forcePreview.length === 0;
        node.textContent = state.forcePreview.length
          ? '将取消以下预约：\\n' + state.forcePreview.map((item) => item.room + ' ' + formatDate(item.start) + '–' + formatDate(item.end) + '：' + item.reason + ' (' + item.id + ')').join('\\n')
          : '当前目标房间和时段没有有效预约。';
      }
      async function submitForceAdjustment(event) {
        event.preventDefault();
        const form = event.currentTarget;
        if (state.forcePreview.length === 0) {
          await previewForceAdjustment();
        }
        if (!window.confirm('确认强制调整？提交前会取消冲突预约，请确认上方预览。')) return;
        try {
          const result = await requestJson('/api/reservations/' + encodeURIComponent(form.reservationId.value) + '/force-adjust', {
            method: 'POST',
            headers: { 'x-actor': 'admin', 'x-idempotency-key': idempotencyKey('force-adjust') },
            body: JSON.stringify({
              roomId: form.roomId.value,
              start: toUtcISOString(form.start.value),
              end: toUtcISOString(form.end.value),
              reason: form.reason.value,
              force: true,
            }),
          });
          showMessage('#force-message', '强制调整完成，取消预约：' + (result.cancelledReservations ?? []).map((reservation) => reservation.id).join(', '));
          state.forcePreview = [];
          renderForcePreview();
          await loadReservations();
          await loadCalendar();
        } catch (error) {
          showMessage('#force-message', renderConflicts(error), true);
        }
      }

      async function bootstrap() {
        const today = localDateInput(new Date());
        $('#calendar-date').value = today;
        $('#reservations-from').value = today;
        $('#reservations-to').value = addLocalDays(today, 7);
        await loadRooms();
        await loadRules();
        await loadReservations();
        await loadCalendar();
      }

      $('#availability-form').addEventListener('submit', loadAvailability);
      $('#reservation-form').addEventListener('submit', createReservation);
      $('#refresh-rooms').addEventListener('click', () => loadRooms().catch((error) => showMessage('#availability-message', renderConflicts(error), true)));
      $('#calendar-day').addEventListener('click', () => { state.calendarView = 'day'; loadCalendar(); });
      $('#calendar-week').addEventListener('click', () => { state.calendarView = 'week'; loadCalendar(); });
      $('#calendar-refresh').addEventListener('click', loadCalendar);
      $('#reservations-refresh').addEventListener('click', loadReservations);
      $('#room-form').addEventListener('submit', saveRoom);
      $('#rule-form').addEventListener('submit', saveRule);
      $('#force-preview').addEventListener('click', () => previewForceAdjustment().catch((error) => showMessage('#force-message', renderConflicts(error), true)));
      $('#force-adjust-form').addEventListener('submit', submitForceAdjustment);
      document.addEventListener('click', (event) => {
        const button = event.target.closest?.('.book-from-result');
        if (!button) return;
        const room = state.rooms.find((item) => item.id === button.dataset.roomId);
        if (!room) return;
        $('#reservation-room').value = room.id;
        $('#reservation-start').value = $('#availability-start').value;
        $('#reservation-end').value = $('#availability-end').value;
        $('#reservation-title').focus();
      });
      bootstrap().catch((error) => showMessage('#availability-message', renderConflicts(error), true));
    </script>
  </body>
</html>`;
}
