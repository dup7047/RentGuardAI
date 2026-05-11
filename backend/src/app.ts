import { Hono } from 'hono';
import { getCommitSha } from './commit.js';
import { requestLogger } from './middleware/request-logger.js';
import { corsMiddleware } from './middleware/cors.js';
import { anonTokenMiddleware } from './middleware/anon-token.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { v1Router } from './routes/v1.js';
import { logger } from './logger.js';

export function createApp(): Hono {
  const app = new Hono();

  app.onError((err, c) => {
    const path = c.req.path;
    logger.error({ err, path }, 'unhandled request error');
    // Keep API failures machine-readable so frontends can render branded
    // recovery states instead of framework default error screens.
    if (path.startsWith('/v1/')) {
      return c.json(
        {
          kind: 'server_error',
          message: 'We hit a server error while loading this information. Please try again.',
        },
        500,
      );
    }
    return c.text('Internal Server Error', 500);
  });

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
