# 本地会议室查询、预订与 Agent 系统

RFC-0001 至 RFC-0004 的单仓 TypeScript Web 工程：权威会议室 API、SQLite
持久化、真实 Nex 意图解析，以及集成在管理页中的 Agent 聊天面板。

## 本地运行

```bash
npm install
cp .env.example .env
chmod 600 .env
# 编辑 .env，只在 NEX_API_KEY 中填写服务端密钥
npm run db:reset
npm start
```

`npm start` 与 `npm run dev` 会从 `.env` 加载真实 Nex 配置，自动创建默认
`data/` 目录、执行 SQLite 迁移和种子数据，并在
`http://localhost:3000/` 提供管理页面和 Agent 聊天面板。缺少必要环境变量时，
服务只报告变量名，不会打印密钥。

`.env` 已被 Git 忽略，必须保持 `600` 权限；不要把真实密钥写入
`.env.example`、日志、测试 fixture 或提交记录。

## Agent

浏览器只向 `POST /api/agent/message` 发送：

```json
{
  "conversationId": "demo-conversation",
  "message": "明天上午 10 点到 11 点有哪些小会议室可用？",
  "requestId": "demo-request-1"
}
```

也可直接用 curl 验证：

```bash
curl -sS http://localhost:3000/api/agent/message \
  -H 'content-type: application/json' \
  --data '{"conversationId":"demo-conversation","message":"明天上午 10 点到 11 点有哪些小会议室可用？","requestId":"demo-request-1"}'
```

用户身份、角色和历史由服务端注入。默认 Demo 身份为
`local-user/member`；需要验收房间或规则管理时，在服务端 `.env` 中把
`MEETING_ROOM_DEMO_ROLE` 临时设为 `admin`。这只是本地 Demo 边界，不是生产认证。

会话历史保存在 SQLite，可通过以下权威接口检查：

- `GET /api/conversations/:conversationId/history`
- `POST /api/conversations/:conversationId/messages`

Agent 的业务写入只走 RFC-0001 权威 API；组合会议室唯一的最小扩展是
`POST /api/rooms/combined`。RFC-0002 早期私有 facade 不再是默认调用路径。

## 数据库

默认数据库路径：`data/meeting-room.sqlite3`。

常用命令：

```bash
npm run db:migrate
npm run db:seed
npm run db:reset
npm test
npm run typecheck
npm run lint
```

常规测试不调用真实 Nex。只有显式启用时才运行 parser smoke：

```bash
RUN_REAL_NEX_SMOKE=true npm run test:nex:smoke
```

## RFC-0004 手工验收

1. 打开 `http://localhost:3000/`，确认聊天面板与原管理功能同时可用。
2. 依次尝试查询可用房间、创建预约、取消刚才的预约。
3. 以 Demo admin 身份创建 506 临时维修规则，再说“刚才说错了，只停用下午”，
   确认更新的是同一条规则。
4. 从页面列表或权威 API 核对 SQLite 状态变化；再输入冲突、缺字段和无权限请求，
   确认 UI 展示结构化错误而不是假成功。

## 基线数据

空数据库迁移并种子化后包含：

- 活动室
- 会议室一 / 会议室二
- 组合空间（占用会议室一、会议室二两个物理资源）
- 502–506 小会议室
- 活动室工作日 11:30–13:30 午餐规则
- 502 每周二全天禁用规则

所有时间均以 `Asia/Shanghai` 解释用户日期，持久化时间点使用 UTC ISO 字符串。
