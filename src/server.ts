/**
 * Hono server entrypoint for the local meeting room system.
 *
 * RFC-0001: 本地会议室查询与预订系统
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { APP_TIMEZONE, DEFAULT_OPEN_HOURS } from '@/config/app';
import { openDatabase, type Database } from '@/db';
import { ensureDatabaseReady } from '@/db/ensure';
import { appErrorHandler } from '@/errors/hono';
import { createAuditRoutes } from '@/server/routes/auditRoutes';
import { createRoomRoutes } from '@/server/routes/roomRoutes';
import { createRuleRoutes } from '@/server/routes/ruleRoutes';

export function createApp(db: Database): Hono {
  const app = new Hono();

  app.use('*', logger());
  app.onError(appErrorHandler);

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      timezone: APP_TIMEZONE,
      defaultOpenHours: DEFAULT_OPEN_HOURS,
    });
  });

  app.get('/', (c) => {
    return c.html(`
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>本地会议室查询与预订系统</title>
  </head>
  <body>
    <main>
      <h1>本地会议室查询与预订系统</h1>
      <p>RFC-0001 本地运行入口已启动。当前子任务实现房间配置、规则管理与审计 API。</p>
      <ul>
        <li><a href="/health">/health</a></li>
        <li><a href="/api/rooms">/api/rooms</a></li>
        <li><a href="/api/rules">/api/rules</a></li>
        <li><a href="/api/audit-events">/api/audit-events</a></li>
      </ul>
    </main>
  </body>
</html>
`);
  });

  app.route('/api/rooms', createRoomRoutes(db));
  app.route('/api/rules', createRuleRoutes(db));
  app.route('/api/audit-events', createAuditRoutes(db));

  return app;
}

export const app = createApp(openDatabase());

export async function startServer(port = Number(process.env.PORT ?? 3000)) {
  ensureDatabaseReady();

  await new Promise<void>((resolve) => {
    serve({
      fetch: app.fetch,
      port,
    }, () => {
      console.log(`Meeting room system listening on http://localhost:${port}`);
      resolve();
    });
  });
}

if (process.env.NODE_ENV !== 'test') {
  void startServer();
}
