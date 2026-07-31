# 本地会议室查询与预订系统

RFC-0001 本地会议室查询与预订系统的单仓 TypeScript Web 工程基线。

## 本地运行

```bash
npm install
npm run start
```

`npm run start` 会在启动时自动执行 SQLite 迁移和种子数据写入，并在 `http://localhost:3000/health` 返回 `Asia/Shanghai` 时区契约。

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

## 基线数据

空数据库迁移并种子化后包含：

- 活动室
- 会议室一 / 会议室二
- 组合空间（占用会议室一、会议室二两个物理资源）
- 502–506 小会议室
- 活动室工作日 11:30–13:30 午餐规则
- 502 每周二全天禁用规则

所有时间均以 `Asia/Shanghai` 解释用户日期，持久化时间点使用 UTC ISO 字符串。
