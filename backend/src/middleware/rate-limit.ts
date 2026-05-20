// Postgres-backed fixed-window rate limiter.
//
// Replaces the in-memory Map we used to use. The Map reset on every restart
// and could be bypassed by round-robin across multi-process deployments. The
// rate_limit_counters table makes the limit multi-process safe and survives
// restarts; each (route_name, subject) gets one row per hour bucket and the
// middleware UPSERTs+returns the post-increment count to decide 429 vs allow.
//
// Per-route limits are configured via `makeRateLimit({...})`. The exported
// `rateLimitMiddleware` is the lookup-route limit (10/h anon, 60/h user) and
// preserves the existing app.ts wiring.

import { createMiddleware } from 'hono/factory';
import { sql as drizzleSql } from 'drizzle-orm';
import { AppError } from '../lib/errors.js';
import { getDb } from '../db/client.js';
import { rateLimitCounters } from '../db/schema.js';
import { logger } from '../logger.js';

const HOUR_MS = 60 * 60 * 1000;

export interface RateLimitOpts {
  /** Route identifier — partitions counters so a user's lookup quota and
   *  building-read quota don't share a bucket. Short snake/kebab is fine. */
  name: string;
  /** Per-hour cap for anonymous requests (keyed on rentguard-anon cookie). */
  anonPerHour: number;
  /** Per-hour cap for authenticated requests (keyed on Supabase user_id). */
  userPerHour: number;
}

/**
 * Increment the per-(route, subject, hour) counter and return the new value.
 *
 * Fixed-window design: `windowStart` is the start of the current hour
 * (UTC, truncated). UPSERT increments the count for that bucket and
 * returns the post-increment value.
 */
async function incrementAndCount(key: string, windowStart: Date): Promise<number> {
  const [row] = await getDb()
    .insert(rateLimitCounters)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimitCounters.key, rateLimitCounters.windowStart],
      set: { count: drizzleSql`${rateLimitCounters.count} + 1` },
    })
    .returning({ count: rateLimitCounters.count });
  return row?.count ?? 1;
}

/**
 * Probabilistically prune buckets older than 2 hours. Called by the
 * middleware on ~1% of requests so we don't need a separate cron job;
 * since each bucket is tiny (one row) and we only keep 2 hours of history,
 * the table stays small even without aggressive pruning.
 */
async function maybePruneOldBuckets(): Promise<void> {
  if (Math.random() > 0.01) return;
  try {
    await getDb()
      .delete(rateLimitCounters)
      .where(drizzleSql`${rateLimitCounters.windowStart} < NOW() - INTERVAL '2 hours'`);
  } catch (e) {
    // Pruning is opportunistic — a failed delete shouldn't break the request.
    logger.warn({ err: String(e) }, 'rate-limit bucket prune failed');
  }
}

/**
 * Build a Hono middleware that enforces a per-route hourly rate limit.
 *
 * Usage:
 * ```
 * app.use('/v1/building/:bbl', makeRateLimit({
 *   name: 'building', anonPerHour: 30, userPerHour: 120,
 * }));
 * ```
 */
export function makeRateLimit(opts: RateLimitOpts) {
  return createMiddleware<{
    Variables: { anonToken: string; userId?: string };
  }>(async (c, next) => {
    const userId = c.get('userId');
    const anon = c.get('anonToken');
    const subject = userId ? `u:${userId}` : `a:${anon}`;
    const key = `${opts.name}:${subject}`;
    const limit = userId ? opts.userPerHour : opts.anonPerHour;

    // Truncate to the hour. fromTime(...) → fromTime(...) ensures every
    // request within the same UTC hour writes to the same bucket row.
    const windowStart = new Date(Math.floor(Date.now() / HOUR_MS) * HOUR_MS);

    const count = await incrementAndCount(key, windowStart);

    if (count > limit) {
      c.header('Retry-After', '3600');
      throw new AppError('rate_limited', 'Too many requests. Try again later.');
    }

    // Fire-and-forget; never blocks the response on a successful path.
    void maybePruneOldBuckets();

    return next();
  });
}

/**
 * Backward-compat: the lookup endpoint's rate limit. Re-exports the same
 * 10/h anon, 60/h user caps that previously lived in the in-memory map.
 */
export const rateLimitMiddleware = makeRateLimit({
  name: 'lookup',
  anonPerHour: 10,
  userPerHour: 60,
});
