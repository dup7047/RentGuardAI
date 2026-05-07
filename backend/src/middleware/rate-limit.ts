// In-memory sliding-window rate limiter.
// Keyed by anon_token (10 req/h), email (30 req/h), or user_id (60 req/h).
// Note: per-email rate limiting for anon requests happens inside the lookup
// handler after body parsing, since we can't peek the body here safely.

import { createMiddleware } from 'hono/factory';

const buckets = new Map<string, number[]>();
const HOUR_MS = 60 * 60 * 1000;

function check(key: string, limit: number): boolean {
  const now = Date.now();
  const windowStart = now - HOUR_MS;
  const arr = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

export const rateLimitMiddleware = createMiddleware<{
  Variables: { anonToken: string; userId?: string };
}>(async (c, next) => {
  const userId = c.get('userId');
  const anon = c.get('anonToken');
  let key: string, limit: number;
  if (userId) {
    key = `u:${userId}`;
    limit = 60;
  } else {
    key = `a:${anon}`;
    limit = 10;
  }
  if (!check(key, limit)) {
    c.header('Retry-After', '3600');
    return c.json(
      { kind: 'rate_limited', message: 'Too many lookups in the last hour. Try again later.' },
      429,
    );
  }
  return next();
});
