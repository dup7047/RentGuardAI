// withDeadline (routes/lookup.ts): dataset fan-out guard.
// A slow dataset resolves with the fallback + degraded, a FAILED dataset must
// ALSO resolve with the fallback + degraded — before this suite existed, a
// rejected dataset promise was swallowed with degraded=false, so the report
// rendered "no records" with no partial-data notice.

import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { withDeadline } from '../src/routes/lookup.js';
import { logger } from '../src/logger.js';

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('withDeadline', () => {
  it('resolves with the value and degraded=false when the promise wins', async () => {
    const r = await withDeadline(Promise.resolve([1, 2]), 1_000, []);
    expect(r).toEqual({ value: [1, 2], degraded: false });
  });

  it('resolves with the fallback and degraded=true on timeout', async () => {
    vi.useFakeTimers();
    const never = new Promise<number[]>(() => {});
    const p = withDeadline(never, 5_000, []);
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(p).resolves.toEqual({ value: [], degraded: true });
  });

  it('resolves with the fallback and degraded=true when the promise rejects', async () => {
    const r = await withDeadline(Promise.reject(new Error('socrata 500')), 1_000, [], 'hpd');
    expect(r).toEqual({ value: [], degraded: true });
  });

  it('logs the dataset label when a promise rejects', async () => {
    await withDeadline(Promise.reject(new Error('boom')), 1_000, [], 'evictions');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'evictions' }),
      expect.stringContaining('dataset fetch failed'),
    );
  });
});
