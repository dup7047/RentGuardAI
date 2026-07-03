// Stale-bucket eviction for the in-memory rate limiter.
// Without sweeping, every distinct anon token / user id ever seen keeps a
// Map entry for the life of the process — unbounded growth on a
// long-running server.

import { describe, it, expect, beforeEach } from 'vitest';
import { sweepStaleBuckets, __bucketsForTest } from '../src/middleware/rate-limit.js';

const HOUR_MS = 60 * 60 * 1000;

describe('sweepStaleBuckets', () => {
  beforeEach(() => {
    __bucketsForTest().clear();
  });

  it('drops buckets whose newest timestamp aged out of the window', () => {
    const now = Date.now();
    const buckets = __bucketsForTest();
    buckets.set('a:stale', [now - 2 * HOUR_MS, now - HOUR_MS - 1]);
    buckets.set('a:empty', []);
    buckets.set('a:fresh', [now - HOUR_MS - 1, now - 30_000]);

    sweepStaleBuckets(now);

    expect(buckets.has('a:stale')).toBe(false);
    expect(buckets.has('a:empty')).toBe(false);
    // A bucket with ANY in-window timestamp survives (newest entry is last).
    expect(buckets.has('a:fresh')).toBe(true);
  });

  it('keeps a bucket whose newest timestamp is exactly inside the window', () => {
    const now = Date.now();
    const buckets = __bucketsForTest();
    buckets.set('a:edge', [now - HOUR_MS + 1]);
    sweepStaleBuckets(now);
    expect(buckets.has('a:edge')).toBe(true);
  });
});
