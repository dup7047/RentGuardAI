// In-memory sliding-window rate limiter.
// Keyed by anon_token (10 req/h), email (30 req/h), or user_id (60 req/h).
// Note: per-email rate limiting for anon requests happens inside the lookup
// handler after body parsing, since we can't peek the body here safely.

import { createMiddleware } from 'hono/factory';
import { AppError } from '../lib/errors.js';

const buckets = new Map<string, number[]>();
const HOUR_MS = 60 * 60 * 1000;

// Buckets whose newest timestamp has aged out of the window are dead weight —
// without eviction, every distinct anon token / user ever seen keeps a Map
// entry for the life of the process. Sweep opportunistically from check() so
// there's no timer to manage (and nothing keeping the event loop alive).
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
let lastSweepAt = Date.now();

export function sweepStaleBuckets(now: number): void {
  const windowStart = now - HOUR_MS;
  for (const [key, timestamps] of buckets) {
    // Timestamps are appended in order, so the last entry is the newest.
    const newest = timestamps[timestamps.length - 1];
    if (newest === undefined || newest <= windowStart) buckets.delete(key);
  }
}

/** Test-only: inspect/seed the module-private bucket map. */
export function __bucketsForTest(): Map<string, number[]> {
  return buckets;
}

function check(key: string, limit: number): boolean {
  const now = Date.now();
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
    lastSweepAt = now;
    sweepStaleBuckets(now);
  }
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
    throw new AppError('rate_limited', 'Too many lookups in the last hour. Try again later.');
  }
  return next();
});
