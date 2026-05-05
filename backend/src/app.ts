import { Hono } from 'hono';
import { getCommitSha } from './commit.js';
import { requestLogger } from './middleware/request-logger.js';

export function createApp(): Hono {
  const app = new Hono();
  app.use('*', requestLogger);

  app.get('/health', (c) => {
    return c.json({ status: 'ok', commit: getCommitSha() });
  });

  return app;
}
