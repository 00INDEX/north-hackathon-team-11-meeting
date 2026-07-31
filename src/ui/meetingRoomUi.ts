/**
 * Web UI for the meeting room management system.
 *
 * RFC-0001: 本地会议室查询与预订系统
 *
 * Renders the three-panel dashboard: Agent chat, weekly calendar, and space status.
 */
export function renderMeetingRoomApp(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>会务 Agent - 会议室管理系统</title>
  <style>${getStyles()}</style>
</head>
<body>
  <!-- 顶部导航栏 -->
  <header class="top-nav">
    <div class="nav-left">
      <div class="logo">
        <svg class="logo-icon" viewBox="0 0 32 32" width="32" height="32">
          <circle cx="16" cy="16" r="14" fill="#0d9488"/>
          <path d="M10 16 Q16 8 22 16 Q16 24 10 16Z" fill="#fff"/>
        </svg>
        <span class="logo-text">会务 Agent</span>
      </div>
      <div class="date-picker">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h12" stroke="currentColor" stroke-width="1.2"/><path d="M5 1v3M11 1v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        <span id="date-range-label">2026年8月3日 — 8月7日</span>
        <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 5l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
      </div>
    </div>
    <nav class="nav-tabs">
      <a class="nav-tab active" href="#" data-tab="calendar">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M2 6h12" stroke="currentColor" stroke-width="1.2"/></svg>
        预订日历
      </a>
      <a class="nav-tab" href="#" data-tab="rooms">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
        会议室
      </a>
      <a class="nav-tab" href="#" data-tab="rules">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        规则中心
      </a>
    </nav>
    <div class="nav-right">
      <button class="icon-btn" aria-label="搜索">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" stroke-width="1.5"/><path d="M13 13l4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
      <button class="icon-btn notification-btn" aria-label="通知">
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 2a5 5 0 00-5 5v3l-1.5 2h13L15 10V7a5 5 0 00-5-5z" stroke="currentColor" stroke-width="1.5"/><path d="M8 17a2 2 0 004 0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        <span class="notification-badge">3</span>
      </button>
      <div class="user-avatar">张</div>
    </div>
  </header>

  <!-- 主内容区域：三栏布局 -->
  <main class="main-content">
    <!-- 左栏：Agent 对话 -->
    <aside class="panel-left">
      <div class="agent-card" data-testid="agent-chat-panel">
        <div class="agent-card-header">
          <div>
            <div class="eyebrow">AI Assistant</div>
            <h2>会务 Agent</h2>
          </div>
          <div class="agent-badge">在线</div>
        </div>
        <div class="agent-session" id="agent-session">会话已就绪</div>
        <div class="chat-messages" id="agent-messages" aria-live="polite">
          <div class="msg-group">
            <div class="msg-time">会务 Agent 09:00</div>
            <div class="msg agent-msg">
              <p>你好，我是会务 Agent。你可以告诉我：</p>
              <p>• 查询某个会议室是否可用</p>
              <p>• 预订或取消会议室</p>
              <p>• 修改会议室规则</p>
            </div>
          </div>
        </div>
        <div class="agent-status" id="agent-status">准备接收指令</div>
        <form class="chat-input-area" id="agent-form">
          <div class="chat-input-wrapper">
            <textarea id="agent-input" class="chat-input" rows="1" placeholder="描述你想预订或配置的内容..."></textarea>
            <button class="send-btn" id="agent-send" type="submit" aria-label="发送">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 10l14-7-7 14v-7H3z" fill="currentColor"/></svg>
            </button>
          </div>
          <div class="quick-actions">
            <button class="quick-btn" type="button">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/><path d="M5 7h4M7 5v4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
              查可用会议室
            </button>
            <button class="quick-btn" type="button">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" fill="#0d9488"/><path d="M4 7h6M7 4v6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/></svg>
              创建规则
            </button>
          </div>
        </form>
      </div>
    </aside>

    <!-- 中栏：本周占用情况 -->
    <section class="panel-center">
      <div class="calendar-header">
        <h2 class="section-title">本周占用情况</h2>
        <div class="calendar-controls">
          <div class="control-select">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="10" rx="2" stroke="currentColor" stroke-width="1.2"/><path d="M1 5h12" stroke="currentColor" stroke-width="1.2"/></svg>
            周视图
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </div>
          <div class="control-select">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="4" width="10" height="7" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M4 2v3M10 2v3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            全部楼层
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2.5 4l2.5 2.5L7.5 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
          </div>
          <button class="btn-primary" id="btn-new-reservation">+ 新建预约</button>
        </div>
      </div>

      <!-- 提示卡片 -->
      <div class="info-card" id="availability-info">
        <div class="info-icon">ℹ️</div>
        <div class="info-content">
          <strong>10:00—11:00</strong>
          <p>可用小会议室：503、506<br>(505 因规则不可用)</p>
        </div>
      </div>

      <!-- 周视图日历网格 -->
      <div class="week-calendar">
        <div class="calendar-grid">
          <!-- 表头 -->
          <div class="grid-header">
            <div class="time-col">时间</div>
            <div class="day-col">周一 8/3</div>
            <div class="day-col">周二 8/4</div>
            <div class="day-col">周三 8/5</div>
            <div class="day-col">周四 8/6</div>
            <div class="day-col">周五 8/7</div>
          </div>
          <!-- 房间行 -->
          <div class="room-row">
            <div class="room-label">活动室 <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2" y="4" width="8" height="6" rx="1.5" stroke="#666" stroke-width="1"/><path d="M4 4V3a2 2 0 014 0v1" stroke="#666" stroke-width="1"/></svg></div>
          </div>
          <!-- 时间网格内容 -->
          <div class="time-grid" id="time-grid">
            <!-- 时间行由 JS 生成 -->
          </div>
        </div>
      </div>

      <!-- 图例 -->
      <div class="calendar-legend">
        <span class="legend-item"><span class="legend-dot booked"></span> 已预约</span>
        <span class="legend-item"><span class="legend-dot blocked"></span> 不可预约</span>
        <span class="legend-item"><span class="legend-dot merged"></span> 合并空间</span>
      </div>
    </section>

    <!-- 右栏：空间状态 -->
    <aside class="panel-right">
      <div class="space-header">
        <h2 class="section-title">空间状态</h2>
        <button class="icon-btn" aria-label="刷新">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13.5 8A5.5 5.5 0 113 5.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M1 3l2 2.5L5.5 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>

      <!-- 楼层平面图 -->
      <div class="floor-plan">
        <div class="floor-map">
          <div class="room-block room-503">503</div>
          <div class="room-block room-504">504</div>
          <div class="room-block room-activity">活动室</div>
          <div class="room-block room-505">505</div>
          <div class="room-block room-meeting1">会议室一</div>
          <div class="room-block room-506">506</div>
          <div class="room-block room-meeting2">会议室二</div>
          <div class="merge-label">可合并</div>
        </div>
        <div class="room-indicators">
          <span class="indicator green"></span>
          <span class="indicator orange"></span>
          <span class="indicator green"></span>
          <span class="indicator green"></span>
          <span class="indicator green"></span>
        </div>
      </div>

      <!-- 房间详情 -->
      <div class="room-detail">
        <div class="detail-header">
          <h3>会议室一 + 会议室二</h3>
          <button class="icon-btn" aria-label="链接"><svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M6 8l2-2m-1.5-1.5L8 3a2.5 2.5 0 013.5 3.5L10 8m-2.5 1.5L6 11a2.5 2.5 0 01-3.5-3.5L4 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
        </div>
        <div class="detail-info">
          <div class="info-row"><span class="info-icon-sm">👥</span> 24人</div>
          <div class="info-row"><span class="info-icon-sm">🖥️</span> 投屏 · 白板 · 视频会议</div>
          <div class="info-row"><span class="info-icon-sm">📍</span> 5F 东侧</div>
          <div class="info-row highlight"><span class="info-icon-sm">📅</span> 周五 14:00 合并占用</div>
        </div>
      </div>

      <!-- 生效规则 -->
      <div class="active-rules">
        <h3>生效规则</h3>
        <div class="rule-list">
          <div class="rule-item">
            <span class="rule-icon lunch">🍴</span>
            <span class="rule-text">活动室午餐时段</span>
            <span class="rule-time">11:30—13:30</span>
          </div>
          <div class="rule-item">
            <span class="rule-icon block">🚫</span>
            <span class="rule-text">505 每周二全天停用</span>
            <span class="rule-time">全天</span>
          </div>
          <div class="rule-item">
            <span class="rule-icon repair">🔧</span>
            <span class="rule-text">504 周三下午维修</span>
            <span class="rule-time">13:00—18:00</span>
          </div>
        </div>
      </div>
    </aside>
  </main>

  <script type="module">${getScript()}</script>
</body>
</html>`;
}

function getStyles(): string {
  return `
:root {
  --primary: #0d9488;
  --primary-light: #ccfbf1;
  --primary-dark: #0f766e;
  --bg: #f8fafb;
  --bg-white: #ffffff;
  --border: #e5e7eb;
  --border-light: #f0f0f0;
  --text: #1f2937;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --radius: 12px;
  --radius-sm: 8px;
  --booked: #dcfce7;
  --booked-border: #86efac;
  --booked-text: #166534;
  --blocked: #fef9c3;
  --blocked-border: #fde047;
  --blocked-text: #854d0e;
  --merged: #dbeafe;
  --merged-border: #93c5fd;
  --merged-text: #1e40af;
  --event-red-bg: #fee2e2;
  --event-red-border: #fca5a5;
  --event-red-text: #991b1b;
  --event-green-bg: #dcfce7;
  --event-green-border: #86efac;
  --event-green-text: #166534;
  --event-orange-bg: #ffedd5;
  --event-orange-border: #fdba74;
  --event-orange-text: #9a3412;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}

* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-size: 14px; line-height: 1.5; overflow: hidden; height: 100vh; }

/* 顶部导航 */
.top-nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 56px;
  padding: 0 24px;
  background: var(--bg-white);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 100;
}
.nav-left { display: flex; align-items: center; gap: 20px; }
.logo { display: flex; align-items: center; gap: 8px; }
.logo-icon { flex-shrink: 0; }
.logo-text { font-size: 18px; font-weight: 700; color: var(--text); }
.date-picker {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 20px;
  border: 1px solid var(--border);
  font-size: 13px; color: var(--text-secondary);
  cursor: pointer;
}
.date-picker:hover { border-color: var(--primary); }
.nav-tabs { display: flex; gap: 4px; }
.nav-tab {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 8px;
  font-size: 14px; font-weight: 500;
  color: var(--text-secondary);
  text-decoration: none;
  transition: all .15s;
}
.nav-tab:hover { color: var(--primary); background: var(--primary-light); }
.nav-tab.active { color: var(--primary); font-weight: 600; }
.nav-right { display: flex; align-items: center; gap: 12px; }
.icon-btn {
  display: flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 50%;
  border: none; background: transparent; color: var(--text-secondary);
  cursor: pointer; position: relative;
}
.icon-btn:hover { background: #f3f4f6; }
.notification-btn .notification-badge {
  position: absolute; top: 4px; right: 4px;
  width: 16px; height: 16px; border-radius: 50%;
  background: #ef4444; color: #fff;
  font-size: 10px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.user-avatar {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--primary); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 600;
}

/* 主内容三栏布局 */
.main-content {
  display: grid;
  grid-template-columns: 320px 1fr 320px;
  height: calc(100vh - 56px);
  overflow: hidden;
}

/* 左栏 - Agent 对话 */
.panel-left {
  display: flex; flex-direction: column;
  border-right: 1px solid var(--border);
  background: var(--bg-white);
  overflow: hidden;
}
.agent-card {
  display: flex; flex-direction: column;
  height: 100%;
}
.agent-card-header {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-light);
}
.agent-card-header h2 {
  margin-top: 2px;
  font-size: 18px; font-weight: 700;
}
.eyebrow {
  font-size: 11px; font-weight: 700; letter-spacing: .08em;
  color: var(--text-muted); text-transform: uppercase;
}
.agent-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 20px;
  background: #dcfce7; color: #166534;
  font-size: 12px; font-weight: 500;
}
.agent-session {
  padding: 8px 20px;
  border-bottom: 1px solid var(--border-light);
  font-size: 11px; font-weight: 700; letter-spacing: .08em;
  color: var(--text-muted); text-transform: uppercase;
}
.chat-header {
  display: flex; align-items: center; gap: 12px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-light);
}
.chat-title { font-size: 18px; font-weight: 700; }
.admin-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 10px; border-radius: 20px;
  background: #dcfce7; color: #166534;
  font-size: 12px; font-weight: 500;
}
.chat-messages {
  flex: 1; overflow-y: auto;
  padding: 16px 20px;
  display: flex; flex-direction: column; gap: 16px;
}
.msg-group { display: flex; flex-direction: column; gap: 6px; }
.msg-time { font-size: 12px; color: var(--text-muted); }
.msg { padding: 12px 16px; border-radius: var(--radius); max-width: 100%; }
.user-msg {
  background: #f3f4f6; align-self: flex-end;
  border-radius: 12px 12px 4px 12px;
}
.user-msg p { margin: 0; }
.agent-msg {
  background: var(--bg-white); border: 1px solid var(--border);
  border-radius: 12px 12px 12px 4px;
}
.msg-status {
  display: flex; align-items: center; gap: 8px;
  margin-bottom: 8px;
}
.msg-status.success .status-icon {
  width: 20px; height: 20px; border-radius: 50%;
  background: #16a34a; color: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 12px;
}
.msg-details { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px; }
.detail-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px; border-radius: 6px;
  background: #f3f4f6; font-size: 12px;
  border: 1px solid var(--border);
}
.detail-row {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px;
}
.pill {
  padding: 2px 8px; border-radius: 12px;
  font-size: 11px; font-weight: 500;
}
.pill.green { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
.time-tag { color: #ea580c; border-color: #fed7aa; background: #fff7ed; }
.rule-tag { color: var(--text-secondary); }
.msg-note { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
.agent-message {
  display: flex; flex-direction: column; gap: 6px;
  max-width: 100%;
}
.agent-message.user { align-self: flex-end; }
.agent-message-meta {
  font-size: 12px; color: var(--text-muted);
}
.agent-bubble {
  padding: 12px 16px; border-radius: var(--radius);
  background: var(--bg-white); border: 1px solid var(--border);
  white-space: pre-wrap; word-break: break-word;
}
.agent-message.user .agent-bubble {
  background: #f3f4f6;
  border-radius: 12px 12px 4px 12px;
}
.agent-message.assistant .agent-bubble {
  border-radius: 12px 12px 12px 4px;
}
.agent-message.error .agent-bubble {
  border-color: #fecaca; background: #fef2f2;
}
.agent-typing {
  display: inline-flex; align-items: center; gap: 4px;
}
.agent-typing span {
  width: 6px; height: 6px; border-radius: 50%;
  background: var(--text-muted);
  animation: typing 1s infinite ease-in-out;
}
.agent-typing span:nth-child(2) { animation-delay: .15s; }
.agent-typing span:nth-child(3) { animation-delay: .3s; }
@keyframes typing {
  0%, 80%, 100% { opacity: .35; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-4px); }
}

/* 聊天输入区 */
.chat-input-area {
  padding: 12px 16px;
  border-top: 1px solid var(--border-light);
}
.chat-input-wrapper {
  display: flex; align-items: center;
  border: 1px solid var(--border);
  border-radius: 24px;
  padding: 4px 4px 4px 16px;
  background: var(--bg-white);
}
.chat-input {
  flex: 1; border: none; outline: none;
  font-size: 14px; background: transparent;
  resize: none; min-height: 24px; max-height: 96px;
  line-height: 24px; padding: 0;
}
.agent-status {
  padding: 8px 20px;
  border-top: 1px solid var(--border-light);
  font-size: 12px; color: var(--text-secondary);
  background: #f9fafb;
}
.agent-status.error {
  color: #b91c1c; background: #fef2f2;
}
.agent-debug {
  margin-top: 10px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: #f9fafb;
  overflow: hidden;
}
.agent-debug summary {
  cursor: pointer;
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-secondary);
}
.agent-debug pre {
  margin: 0;
  padding: 10px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.45;
}
.send-btn {
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--primary); color: #fff;
  border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.send-btn:hover { background: var(--primary-dark); }
.quick-actions { display: flex; gap: 8px; margin-top: 10px; }
.quick-btn {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 14px; border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--bg-white); color: var(--text-secondary);
  font-size: 13px; cursor: pointer;
}
.quick-btn:hover { border-color: var(--primary); color: var(--primary); }

/* 中栏 - 日历 */
.panel-center {
  display: flex; flex-direction: column;
  overflow: hidden;
  padding: 20px 24px;
  background: var(--bg-white);
}
.calendar-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}
.section-title { font-size: 18px; font-weight: 700; }
.calendar-controls { display: flex; align-items: center; gap: 10px; }
.control-select {
  display: flex; align-items: center; gap: 4px;
  padding: 6px 12px; border-radius: 8px;
  border: 1px solid var(--border);
  font-size: 13px; color: var(--text-secondary);
  cursor: pointer;
}
.control-select:hover { border-color: var(--primary); }
.btn-primary {
  padding: 8px 16px; border-radius: 8px;
  background: var(--primary); color: #fff;
  border: none; font-size: 13px; font-weight: 600;
  cursor: pointer;
}
.btn-primary:hover { background: var(--primary-dark); }

/* 信息卡片 */
.info-card {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 16px; border-radius: var(--radius-sm);
  border: 1px solid var(--border); background: #fafafa;
  margin-bottom: 16px;
}
.info-icon { font-size: 16px; }
.info-content { font-size: 13px; }
.info-content strong { display: block; margin-bottom: 2px; }
.info-content p { margin: 0; color: var(--text-secondary); }

/* 周日历网格 */
.week-calendar { flex: 1; overflow-y: auto; }
.calendar-grid { min-width: 100%; }
.grid-header {
  display: grid;
  grid-template-columns: 60px repeat(5, 1fr);
  border-bottom: 1px solid var(--border);
  position: sticky; top: 0;
  background: var(--bg-white); z-index: 5;
}
.time-col, .day-col {
  padding: 10px 8px;
  font-size: 13px; font-weight: 600;
  color: var(--text-secondary);
  text-align: center;
}
.time-col { text-align: right; }
.room-row {
  display: grid;
  grid-template-columns: 60px repeat(5, 1fr);
  border-bottom: 1px solid var(--border-light);
}
.room-label {
  display: flex; align-items: center; gap: 4px;
  padding: 8px; font-size: 13px; font-weight: 500;
  color: var(--text-secondary);
  grid-column: 1 / -1;
}
.time-grid {
  display: grid;
  grid-template-columns: 60px repeat(5, 1fr);
}
.time-slot {
  padding: 4px 0;
  font-size: 12px; color: var(--text-muted);
  text-align: right; padding-right: 8px;
  border-bottom: 1px solid var(--border-light);
  min-height: 48px;
  display: flex; align-items: flex-start; justify-content: flex-end;
}
.day-cell {
  border-bottom: 1px solid var(--border-light);
  border-left: 1px solid var(--border-light);
  min-height: 48px;
  padding: 2px;
  position: relative;
}
.event {
  padding: 4px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.3;
  margin: 1px;
  border-left: 3px solid;
}
.event-booked { background: var(--booked); border-color: var(--booked-border); color: var(--booked-text); }
.event-blocked { background: var(--blocked); border-color: var(--blocked-border); color: var(--blocked-text); }
.event-merged { background: var(--merged); border-color: var(--merged-border); color: var(--merged-text); }
.event-red { background: var(--event-red-bg); border-color: var(--event-red-border); color: var(--event-red-text); }
.event-green { background: var(--event-green-bg); border-color: var(--event-green-border); color: var(--event-green-text); }
.event-orange { background: var(--event-orange-bg); border-color: var(--event-orange-border); color: var(--event-orange-text); }
.event-allday {
  background: #fef2f2; border-color: #fca5a5; color: #991b1b;
  position: absolute; top: 0; left: 2px; right: 2px;
  bottom: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  border-left: 3px solid #fca5a5;
  border-radius: 4px;
  font-size: 11px;
}

/* 图例 */
.calendar-legend {
  display: flex; gap: 20px; padding: 12px 0;
  border-top: 1px solid var(--border-light);
  margin-top: 12px;
}
.legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); }
.legend-dot {
  width: 14px; height: 14px; border-radius: 3px;
}
.legend-dot.booked { background: var(--booked); border: 1px solid var(--booked-border); }
.legend-dot.blocked { background: var(--blocked); border: 1px solid var(--blocked-border); }
.legend-dot.merged { background: var(--merged); border: 1px solid var(--merged-border); }

/* 右栏 */
.panel-right {
  display: flex; flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg-white);
  overflow-y: auto;
  padding: 16px 20px;
}
.space-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16px;
}

/* 楼层平面图 */
.floor-plan {
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  border-radius: var(--radius);
  padding: 16px;
  margin-bottom: 16px;
  position: relative;
}
.floor-map {
  display: grid;
  grid-template-columns: 1fr 1fr 40px;
  grid-template-rows: auto auto auto auto;
  gap: 6px;
  min-height: 180px;
}
.room-block {
  background: #dcfce7;
  border: 1.5px solid #86efac;
  border-radius: 6px;
  padding: 8px;
  font-size: 11px;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #166534;
}
.room-activity { grid-column: 1 / 2; grid-row: 2 / 4; background: #bbf7d0; }
.room-meeting1 { grid-column: 1 / 2; }
.room-meeting2 { grid-column: 2 / 3; }
.room-503 { grid-column: 3 / 4; grid-row: 1; font-size: 10px; }
.room-504 { grid-column: 3 / 4; grid-row: 2; font-size: 10px; }
.room-505 { grid-column: 3 / 4; grid-row: 3; font-size: 10px; }
.room-506 { grid-column: 3 / 4; grid-row: 4; font-size: 10px; }
.merge-label {
  position: absolute;
  bottom: 60px; left: 50%;
  transform: translateX(-50%);
  background: var(--bg-white);
  border: 1px dashed var(--primary);
  color: var(--primary);
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
}
.room-indicators {
  position: absolute;
  right: 8px; top: 16px;
  display: flex; flex-direction: column; gap: 8px;
}
.indicator {
  width: 8px; height: 8px; border-radius: 50%;
}
.indicator.green { background: #22c55e; }
.indicator.orange { background: #f97316; }

/* 房间详情 */
.room-detail {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 14px;
  margin-bottom: 16px;
}
.detail-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.detail-header h3 { font-size: 15px; font-weight: 600; }
.detail-info { display: flex; flex-direction: column; gap: 6px; }
.info-row {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; color: var(--text-secondary);
}
.info-row.highlight {
  margin-top: 4px; padding: 6px 10px;
  background: #eff6ff; border-radius: 6px;
  color: #1d4ed8; font-weight: 500;
}
.info-icon-sm { font-size: 14px; }

/* 生效规则 */
.active-rules h3 { font-size: 15px; font-weight: 600; margin-bottom: 10px; }
.rule-list { display: flex; flex-direction: column; gap: 8px; }
.rule-item {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: #f9fafb;
  border: 1px solid var(--border-light);
}
.rule-icon { font-size: 14px; }
.rule-text { flex: 1; font-size: 13px; }
.rule-time { font-size: 12px; color: var(--text-muted); white-space: nowrap; }

/* 滚动条美化 */
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #9ca3af; }

/* 响应式 */
@media (max-width: 1200px) {
  .main-content { grid-template-columns: 280px 1fr 280px; }
}
@media (max-width: 900px) {
  .main-content { grid-template-columns: 1fr; }
  .panel-left, .panel-right { display: none; }
}
`;
}

function getScript(): string {
  return `
// ===== 全局状态 =====
const WEEK_START = '2026-08-03'; // 周一
const DAYS = ['周一 8/3','周二 8/4','周三 8/5','周四 8/6','周五 8/7'];
const HOURS = ['09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00'];
const TZ_OFFSET = 8; // Asia/Shanghai UTC+8
const AGENT_CONVERSATION_STORAGE_KEY = 'meeting-room-agent-conversation-id';
const AGENT_MUTATION_ACTIONS = new Set([
  'create_booking',
  'cancel_booking',
  'create_unavailability_rule',
  'update_last_unavailability_rule',
  'create_or_update_room',
  'create_combined_room',
]);

let rooms = [];
let reservations = [];
let rules = [];
let agentLoading = false;
let agentConversationId = '';

// ===== API 请求 =====
async function fetchJson(url, options = {}) {
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

// ===== 时间工具 =====
function pad(value) { return String(value).padStart(2, '0'); }
function toShanghaiHour(isoStr) {
  const d = new Date(isoStr);
  return d.getUTCHours() + TZ_OFFSET;
}
function toShanghaiMin(isoStr) {
  return new Date(isoStr).getUTCMinutes();
}
function getDayIndex(isoStr) {
  // 返回 0-4 对应周一到周五 (基于 WEEK_START)
  const d = new Date(isoStr);
  const utcDay = new Date(d.getTime() + TZ_OFFSET * 3600000);
  const weekStart = new Date('2026-08-03T00:00:00+08:00');
  const diff = Math.floor((utcDay - weekStart) / (24 * 3600000));
  return diff;
}
function formatHM(isoStr) {
  const h = toShanghaiHour(isoStr);
  const m = toShanghaiMin(isoStr);
  return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
}
function roomName(roomId) {
  const r = rooms.find(r => r.id === roomId);
  return r ? r.name : roomId;
}
function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

// ===== 日历渲染 =====
function renderCalendar() {
  const timeGrid = document.getElementById('time-grid');
  if (!timeGrid) return;

  // 构建事件列表
  const events = [];

  // 1. 从预约数据生成事件
  for (const res of reservations) {
    if (res.status !== 'active') continue;
    const dayIdx = getDayIndex(res.start);
    if (dayIdx < 0 || dayIdx > 4) continue;
    const startH = toShanghaiHour(res.start);
    const startM = toShanghaiMin(res.start);
    const endH = toShanghaiHour(res.end);
    const endM = toShanghaiMin(res.end);
    // 判断类型：合并空间
    let type = 'booked';
    if (res.roomId === 'room-combined') type = 'merged';
    events.push({
      day: dayIdx,
      startHour: startH,
      startMin: startM,
      endHour: endH,
      endMin: endM,
      title: formatHM(res.start) + '—' + formatHM(res.end) + '\\n' + (res.title || '未命名预约') + (type === 'merged' ? '\\n' + (res.description || '') : ''),
      type,
      roomId: res.roomId,
    });
  }

  // 2. 从规则生成阻断事件
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (rule.ruleType === 'periodic_block' && rule.recurrence) {
      const rec = typeof rule.recurrence === 'string' ? JSON.parse(rule.recurrence) : rule.recurrence;
      if (rec.type === 'weekly') {
        // 映射 weekdays (1=Mon..5=Fri) 到日期索引
        for (const wd of rec.weekdays) {
          const dayIdx = wd - 1; // weekday 1=Mon -> index 0
          if (dayIdx < 0 || dayIdx > 4) continue;
          const [sh, sm] = (rec.timeStart || '00:00').split(':').map(Number);
          const [eh, em] = (rec.timeEnd || '24:00').split(':').map(Number);
          const isAllDay = (sh === 0 && (eh === 24 || eh === 0) && sm === 0 && (em === 0));
          let type = 'blocked';
          if (isAllDay) type = 'allday';
          let title = '';
          if (isAllDay) {
            title = '全天\\n' + rule.reason;
          } else {
            title = rec.timeStart + '—' + rec.timeEnd + '\\n' + rule.reason;
          }
          events.push({ day: dayIdx, startHour: sh, startMin: sm, endHour: eh, endMin: em, title, type, roomId: rule.targetId });
        }
      }
    } else if (rule.ruleType === 'one_time_block') {
      const dayIdx = getDayIndex(rule.start);
      if (dayIdx < 0 || dayIdx > 4) continue;
      const startH = toShanghaiHour(rule.start);
      const startM = toShanghaiMin(rule.start);
      const endH = toShanghaiHour(rule.end);
      const endM = toShanghaiMin(rule.end);
      events.push({
        day: dayIdx,
        startHour: startH,
        startMin: startM,
        endHour: endH,
        endMin: endM,
        title: formatHM(rule.start) + '—' + formatHM(rule.end) + '\\n' + rule.reason,
        type: 'orange',
        roomId: rule.targetId,
      });
    }
  }

  // 渲染网格
  let html = '';
  for (let h = 0; h < HOURS.length; h++) {
    const hourVal = h + 9;
    html += '<div class="time-slot">' + HOURS[h] + '</div>';
    for (let d = 0; d < 5; d++) {
      const cellEvents = events.filter(e => e.day === d && e.startHour === hourVal);
      let cellHtml = '';
      for (const ev of cellEvents) {
        const typeClass = ev.type === 'booked' ? 'event-booked' :
                         ev.type === 'blocked' ? 'event-blocked' :
                         ev.type === 'merged' ? 'event-merged' :
                         ev.type === 'red' ? 'event-red' :
                         ev.type === 'orange' ? 'event-orange' :
                         ev.type === 'allday' ? 'event-allday' : 'event-booked';
        cellHtml += '<div class="event ' + typeClass + '">' + escapeHtml(ev.title).replace(/\\n/g, '<br>') + '</div>';
      }
      html += '<div class="day-cell">' + cellHtml + '</div>';
    }
  }
  timeGrid.innerHTML = html;
}

// ===== 右侧规则列表渲染 =====
function renderRuleList() {
  const ruleList = document.querySelector('.rule-list');
  if (!ruleList) return;

  let html = '';
  for (const rule of rules) {
    if (!rule.enabled) continue;
    let icon = '📋';
    let timeStr = '';
    if (rule.ruleType === 'periodic_block' && rule.recurrence) {
      const rec = typeof rule.recurrence === 'string' ? JSON.parse(rule.recurrence) : rule.recurrence;
      const isAllDay = rec.timeStart === '00:00' && (rec.timeEnd === '24:00' || rec.timeEnd === '00:00');
      timeStr = isAllDay ? '全天' : (rec.timeStart + '—' + rec.timeEnd);
      if (rule.reason.includes('午餐') || rule.reason.includes('餐厅')) icon = '🍴';
      else if (isAllDay) icon = '🚫';
      else icon = '📋';
    } else if (rule.ruleType === 'one_time_block') {
      icon = '🔧';
      timeStr = formatHM(rule.start) + '—' + formatHM(rule.end);
    }
    const rName = roomName(rule.targetId);
    html += '<div class="rule-item">' +
      '<span class="rule-icon">' + icon + '</span>' +
      '<span class="rule-text">' + escapeHtml(rName + ' ' + rule.reason) + '</span>' +
      '<span class="rule-time">' + escapeHtml(timeStr) + '</span>' +
    '</div>';
  }
  ruleList.innerHTML = html;
}

// ===== 信息卡片渲染 =====
function renderInfoCard() {
  const infoContent = document.querySelector('.info-content');
  if (!infoContent) return;
  // 统计当前可用房间
  const availableSmall = rooms.filter(r => r.enabled && (r.type === '小会议室' || r.type === 'small'));
  const blockedRoomIds = new Set(rules.filter(r => r.enabled).map(r => r.targetId));
  const available = availableSmall.filter(r => !blockedRoomIds.has(r.id));
  const blocked = availableSmall.filter(r => blockedRoomIds.has(r.id));
  infoContent.innerHTML = '<strong>当前可用小会议室</strong>' +
    '<p>可用：' + (available.length ? available.map(r => r.name).join('、') : '无') +
    (blocked.length > 0 ? '<br>(' + blocked.map(r => r.name).join('、') + ' 因规则不可用)' : '') + '</p>';
}

// ===== Agent 聊天功能 =====
function createConversationId() {
  if (globalThis.crypto?.randomUUID) return 'conversation-' + globalThis.crypto.randomUUID();
  return 'conversation-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
function getOrCreateConversationId() {
  try {
    const stored = localStorage.getItem(AGENT_CONVERSATION_STORAGE_KEY);
    if (stored) return stored;
    const created = createConversationId();
    localStorage.setItem(AGENT_CONVERSATION_STORAGE_KEY, created);
    return created;
  } catch {
    return createConversationId();
  }
}
function idempotencyKey(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}
function buildAgentMessagePayload(message) {
  return {
    conversationId: agentConversationId,
    message,
    requestId: idempotencyKey('agent-message'),
  };
}
async function requestAgentMessage(message) {
  let response;
  try {
    response = await fetch('/api/agent/message', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildAgentMessagePayload(message)),
    });
  } catch {
    throw new Error('无法连接 Agent 服务，请确认本地服务已启动并稍后重试。');
  }

  const rawBody = await response.text();
  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    const status = response.ok ? '' : '（HTTP ' + response.status + '）';
    throw new Error('Agent 服务返回了无法识别的响应' + status + '，请稍后重试。');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Agent 服务返回的数据格式不正确，请稍后重试。');
  }
  if (!response.ok) {
    const detail = body.error?.message ?? body.reply ?? response.statusText ?? '请求失败';
    throw Object.assign(
      new Error('Agent 请求失败（HTTP ' + response.status + '）：' + detail),
      { agentResponse: body },
    );
  }
  if (typeof body.reply !== 'string' || body.reply.trim() === '') {
    throw new Error('Agent 服务没有返回可展示的回复，请稍后重试。');
  }
  return body;
}
function debugJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '结构化数据无法序列化';
  }
}
function appendAgentMessage(role, content, options = {}) {
  const list = $('#agent-messages');
  const article = document.createElement('article');
  article.className = 'agent-message ' + role + (options.isError ? ' error' : '');

  const meta = document.createElement('span');
  meta.className = 'agent-message-meta';
  meta.textContent = role === 'user' ? '你' : 'Agent';
  article.append(meta);

  const bubble = document.createElement('div');
  bubble.className = 'agent-bubble';
  bubble.textContent = content;

  const actions = Array.isArray(options.actions) ? options.actions : [];
  const hasDebug = options.parsedIntent !== undefined || actions.length > 0 || options.error;
  if (hasDebug) {
    const details = document.createElement('details');
    details.className = 'agent-debug';
    const summary = document.createElement('summary');
    summary.textContent = '查看解析意图与动作' + (actions.length ? ' · ' + actions.length : '');
    const pre = document.createElement('pre');
    pre.textContent = debugJson({
      parsedIntent: options.parsedIntent ?? null,
      actions,
      error: options.error ?? null,
    });
    details.append(summary, pre);
    bubble.append(details);
  }

  article.append(bubble);
  list.append(article);
  list.scrollTop = list.scrollHeight;
}
function setAgentLoading(isLoading) {
  agentLoading = isLoading;
  const input = $('#agent-input');
  const button = $('#agent-send');
  input.disabled = isLoading;
  button.disabled = isLoading || input.value.trim() === '';
  button.textContent = isLoading ? '处理中…' : '';
  $('#agent-messages').setAttribute('aria-busy', String(isLoading));

  $('#agent-loading')?.remove();
  if (isLoading) {
    const loading = document.createElement('article');
    loading.id = 'agent-loading';
    loading.className = 'agent-message assistant';
    loading.innerHTML = '<span class="agent-message-meta">Agent</span><div class="agent-bubble"><span class="agent-typing" aria-label="Agent 正在处理"><span></span><span></span><span></span></span></div>';
    $('#agent-messages').append(loading);
    $('#agent-messages').scrollTop = $('#agent-messages').scrollHeight;
  }
}
function setAgentStatus(message, isError = false) {
  const status = $('#agent-status');
  status.textContent = message;
  status.className = isError ? 'agent-status error' : 'agent-status';
}
function hasSuccessfulAgentMutation(actions) {
  return Array.isArray(actions) && actions.some((action) =>
    action && action.status === 'completed' && AGENT_MUTATION_ACTIONS.has(action.type),
  );
}
async function refreshAfterAgentMutation(actions) {
  if (!hasSuccessfulAgentMutation(actions)) return false;
  const results = await Promise.allSettled([
    loadRooms(),
    loadReservations(),
    loadRules(),
    loadCalendar(),
  ]);
  const failedCount = results.filter((result) => result.status === 'rejected').length;
  if (failedCount > 0) {
    setAgentStatus('Agent 操作已完成，但有 ' + failedCount + ' 个管理视图刷新失败，可手动刷新确认。', true);
  } else {
    setAgentStatus('操作已完成，会议室、预约、规则与日历视图已同步。');
  }
  return true;
}
async function sendAgentMessage(event) {
  event.preventDefault();
  if (agentLoading) return;
  const input = $('#agent-input');
  const message = input.value.trim();
  if (!message) return;

  appendAgentMessage('user', message);
  input.value = '';
  setAgentLoading(true);
  setAgentStatus('正在理解并执行你的请求…');

  try {
    const response = await requestAgentMessage(message);
    $('#agent-loading')?.remove();
    appendAgentMessage('assistant', response.reply, {
      parsedIntent: response.parsedIntent,
      actions: response.actions,
      error: response.error,
      isError: Boolean(response.error),
    });
    const refreshed = await refreshAfterAgentMutation(response.actions);
    if (!refreshed) {
      setAgentStatus(response.error ? '请求未完成，请根据上方提示调整后重试。' : '已回复。', Boolean(response.error));
    }
  } catch (error) {
    $('#agent-loading')?.remove();
    const message = error instanceof Error ? error.message : 'Agent 请求失败，请稍后重试。';
    const agentResponse = error && typeof error === 'object' ? error.agentResponse : undefined;
    appendAgentMessage('assistant', agentResponse?.reply ?? message, {
      parsedIntent: agentResponse?.parsedIntent,
      actions: agentResponse?.actions,
      isError: true,
      error: agentResponse?.error ?? { message },
    });
    setAgentStatus(message, true);
  } finally {
    setAgentLoading(false);
    input.focus();
  }
}
function initializeAgentChat() {
  agentConversationId = getOrCreateConversationId();
  $('#agent-session').textContent = 'SESSION ' + agentConversationId.slice(-8).toUpperCase();
  const input = $('#agent-input');
  input.addEventListener('input', () => {
    $('#agent-send').disabled = agentLoading || input.value.trim() === '';
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    if (!agentLoading && input.value.trim()) $('#agent-form').requestSubmit();
  });
  $('#agent-form').addEventListener('submit', sendAgentMessage);
}

// ===== 导航标签切换 =====
function initNav() {
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
}

// ===== 启动：加载真实数据 =====
async function loadRooms() {
  rooms = await fetchJson('/api/rooms');
  renderInfoCard();
  return rooms;
}
async function loadRules() {
  rules = await fetchJson('/api/rules');
  renderRuleList();
  return rules;
}
async function loadReservations() {
  const from = '2026-08-03T00:00:00.000Z';
  const to = '2026-08-08T00:00:00.000Z';
  reservations = await fetchJson('/api/reservations?from=' + from + '&to=' + to);
  return reservations;
}
async function loadCalendar() {
  return loadReservations();
}
async function loadData() {
  try {
    const results = await Promise.allSettled([loadRooms(), loadRules(), loadCalendar()]);
    results.forEach((result) => {
      if (result.status === 'rejected') console.error('加载数据失败:', result.reason);
    });
    renderCalendar();
  } catch (err) {
    console.error('加载数据失败:', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initializeAgentChat();
  initNav();
  loadData();
});
`;
}
