import { Hono } from 'hono';
import { getCommitSha } from './commit.js';
import { requestLogger } from './middleware/request-logger.js';
import { corsMiddleware } from './middleware/cors.js';
import { anonTokenMiddleware } from './middleware/anon-token.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { v1Router } from './routes/v1.js';

export function createApp(): Hono {
  const app = new Hono();
  app.use('*', requestLogger);

  // /v1/* middleware stack
  app.use('/v1/*', corsMiddleware);
  app.use('/v1/*', anonTokenMiddleware);
  app.use('/v1/*', authMiddleware);
  app.use('/v1/lookup', rateLimitMiddleware);
  app.use('/v1/lookup/stream', rateLimitMiddleware);

  app.get('/health', (c) => {
    return c.json({ status: 'ok', commit: getCommitSha() });
  });

  app.route('/v1', v1Router);

  return app;
}
