import { Hono } from 'hono';
import { getCommitSha } from './commit.js';
import { requestLogger } from './middleware/request-logger.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { corsMiddleware } from './middleware/cors.js';
import { anonTokenMiddleware } from './middleware/anon-token.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { validateLookupBodyMiddleware } from './routes/lookup.js';
import { v1Router } from './routes/v1.js';
import { logger } from './logger.js';
import { AppError, isAppError, toEnvelope } from './lib/errors.js';

export function createApp(): Hono<{ Variables: { requestId: string } }> {
  const app = new Hono<{ Variables: { requestId: string } }>();

  app.onError((err, c) => {
    const path = c.req.path;
    const requestId = c.get('requestId') ?? 'unknown';
    // AppError is "expected": validation, auth, rate-limit, etc. Log at warn
    // (with code) so a flood of 4xx doesn't drown the error log; only
    // unexpected throws hit the error level.
    if (isAppError(err)) {
      logger.warn({ err, path, requestId, code: err.code }, 'app error');
      if (path.startsWith('/v1/')) {
        return c.json(toEnvelope(err, requestId), err.status as 400 | 401 | 403 | 404 | 429 | 402 | 500);
      }
      return c.text(err.message, err.status as 400 | 401 | 403 | 404 | 429 | 402 | 500);
    }
    logger.error({ err, path, requestId }, 'unhandled request error');
    if (path.startsWith('/v1/')) {
      const wrapped = new AppError(
        'internal_error',
        'We hit a server error while loading this information. Please try again.',
      );
      return c.json(toEnvelope(wrapped, requestId), 500);
    }
    return c.text('Internal Server Error', 500);
  });

  app.use('*', requestIdMiddleware);
  app.use('*', requestLogger);

  // /v1/* middleware stack
  app.use('/v1/*', corsMiddleware);
  app.use('/v1/*', anonTokenMiddleware);
  app.use('/v1/*', authMiddleware);
  // Body validation MUST run before rate-limit so malformed-JSON spam
  // does not burn the per-anon quota (the rate-limit middleware
  // increments a sliding-window counter unconditionally on entry).
  app.use('/v1/lookup', validateLookupBodyMiddleware);
  app.use('/v1/lookup/stream', validateLookupBodyMiddleware);
  app.use('/v1/lookup', rateLimitMiddleware);
  app.use('/v1/lookup/stream', rateLimitMiddleware);

  app.get('/health', (c) => {
    return c.json({ status: 'ok', commit: getCommitSha() });
  });

  app.route('/v1', v1Router);

  return app;
}
