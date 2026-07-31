import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { APP_TIMEZONE, DEFAULT_OPEN_HOURS } from '@/config/app';
import { ensureDatabaseReady } from '@/db/ensure';

export const app = new Hono();

app.use('*', logger());

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
      <p>RFC-0001 本地运行入口已启动。当前子任务先建立工程与持久化基线。</p>
      <ul>
        <li><a href="/health">/health</a></li>
      </ul>
    </main>
  </body>
</html>
`);
});

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
