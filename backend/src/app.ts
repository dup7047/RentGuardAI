import { Hono } from 'hono';
import { getCommitSha } from './commit.js';
import { requestLogger } from './middleware/request-logger.js';
import { requestIdMiddleware } from './middleware/request-id.js';
import { corsMiddleware } from './middleware/cors.js';
import { anonTokenMiddleware } from './middleware/anon-token.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware, makeRateLimit } from './middleware/rate-limit.js';
import { validateLookupBodyMiddleware } from './routes/lookup.js';
import { validateAffiliateClickBody } from './routes/affiliate-click.js';
import { validateWaitlistEmailBody } from './routes/waitlist-email.js';
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
  // increments a counter on entry).
  app.use('/v1/lookup', validateLookupBodyMiddleware);
  app.use('/v1/lookup/stream', validateLookupBodyMiddleware);
  app.use('/v1/lookup', rateLimitMiddleware);
  app.use('/v1/lookup/stream', rateLimitMiddleware);

  // Rate limits on the remaining public, anon-accessible routes. Without
  // these, attackers could enumerate every NYC building on GET /v1/building
  // (each cache-miss triggers 8 dataset fetches + an OpenAI call), spam
  // affiliate-click rows, or fan-out arbitrary emails to Beehiiv.
  // Per-route limits intentionally differ — reads are cheaper than writes;
  // the Beehiiv-fronted waitlist is the strictest because abuse there
  // damages our sender reputation.
  //
  // For POST routes, body validation MUST run before rate-limit (same
  // reasoning as /v1/lookup): otherwise malformed JSON spam burns the
  // anon quota and locks out legitimate users. The route handlers re-run
  // validate() as defense-in-depth; the second pass is idempotent.
  app.use(
    '/v1/building/:bbl',
    makeRateLimit({ name: 'building', anonPerHour: 30, userPerHour: 120 }),
  );
  app.use('/v1/affiliate/click', validateAffiliateClickBody);
  app.use(
    '/v1/affiliate/click',
    makeRateLimit({ name: 'affiliate', anonPerHour: 50, userPerHour: 200 }),
  );
  app.use('/v1/waitlist/email', validateWaitlistEmailBody);
  app.use(
    '/v1/waitlist/email',
    makeRateLimit({ name: 'waitlist', anonPerHour: 10, userPerHour: 50 }),
  );

  app.get('/health', (c) => {
    return c.json({ status: 'ok', commit: getCommitSha() });
  });

  app.route('/v1', v1Router);

  return app;
}
