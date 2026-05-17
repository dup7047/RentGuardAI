// Phase 11.4: withRetry + fetchWithRetry from lib/api/backend.ts.
// Validates exponential backoff and the cold-start event dispatch.
//
// Retry delays are 1s, 3s, 9s. Use fake timers to keep the test fast.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

let withRetry: typeof import('../lib/api/backend').withRetry;
let fetchWithRetry: typeof import('../lib/api/backend').fetchWithRetry;
let FetchHttpError: typeof import('../lib/api/backend').FetchHttpError;

beforeEach(async () => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  ({ withRetry, fetchWithRetry, FetchHttpError } = await import('../lib/api/backend'));
});

afterEach(() => {
  vi.useRealTimers();
});

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('withRetry', () => {
  it('returns on first success without delay', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const p = withRetry(fn);
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries up to 3 times on retryable error then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new FetchHttpError(503, null))
      .mockRejectedValueOnce(new FetchHttpError(503, null))
      .mockResolvedValueOnce('ok');
    const p = withRetry(fn);
    // 1s + 3s = 4s of backoff before the 3rd attempt resolves.
    await vi.advanceTimersByTimeAsync(4_000);
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on 4xx', async () => {
    const fn = vi.fn().mockRejectedValue(new FetchHttpError(400, null));
    await expect(withRetry(fn)).rejects.toBeInstanceOf(FetchHttpError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('emits rentguard:request-slow when in-flight crosses 5s', async () => {
    const slowSpy = vi.fn();
    window.addEventListener('rentguard:request-slow', slowSpy);
    let resolveFn: ((value: string) => void) | undefined;
    const fn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFn = resolve;
        }),
    );
    const p = withRetry(fn);
    await vi.advanceTimersByTimeAsync(5_100);
    expect(slowSpy).toHaveBeenCalledTimes(1);
    resolveFn?.('done');
    await p;
    window.removeEventListener('rentguard:request-slow', slowSpy);
  });

  it('does not emit slow event when silent: true', async () => {
    const slowSpy = vi.fn();
    window.addEventListener('rentguard:request-slow', slowSpy);
    let resolveFn: ((value: string) => void) | undefined;
    const fn = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFn = resolve;
        }),
    );
    const p = withRetry(fn, { silent: true });
    await vi.advanceTimersByTimeAsync(5_100);
    expect(slowSpy).not.toHaveBeenCalled();
    resolveFn?.('done');
    await p;
    window.removeEventListener('rentguard:request-slow', slowSpy);
  });

  // Phase 11 follow-up: prevent counter drift when multiple attempts in
  // the SAME withRetry call each cross the 5s threshold. The hook
  // (useColdStartHint) counts events ±1, so two slow events + one
  // slow-end would leak +1 in `pending` forever and pin the
  // "Warming up…" hint on after the request finishes.
  it('emits exactly one slow + one slow-end across a retried slow call', async () => {
    const slowSpy = vi.fn();
    const slowEndSpy = vi.fn();
    window.addEventListener('rentguard:request-slow', slowSpy);
    window.addEventListener('rentguard:request-slow-end', slowEndSpy);

    let attempt = 0;
    const fn = vi.fn(async () => {
      attempt++;
      // Hold the attempt open past the 5s threshold so the slow timer
      // fires on EVERY attempt. Without the fix, that means N slow
      // events for an N-attempt call.
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      if (attempt < 3) {
        const err = new Error('retryable') as Error & { status: number };
        err.status = 503;
        throw err;
      }
      return 'ok';
    });

    const p = withRetry(fn);
    // Drive the clock far enough to cover three 6s attempts plus the
    // 1s + 3s backoffs between them — total 22s.
    await vi.advanceTimersByTimeAsync(22_000);
    await expect(p).resolves.toBe('ok');

    expect(fn).toHaveBeenCalledTimes(3);
    expect(slowSpy).toHaveBeenCalledTimes(1);
    expect(slowEndSpy).toHaveBeenCalledTimes(1);

    window.removeEventListener('rentguard:request-slow', slowSpy);
    window.removeEventListener('rentguard:request-slow-end', slowEndSpy);
  });
});

describe('fetchWithRetry', () => {
  it('retries 503 → 503 → 200 and returns the final response', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(503))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    const p = fetchWithRetry('/x');
    await vi.advanceTimersByTimeAsync(4_000);
    const res = await p;
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns 4xx without retrying', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: { code: 'validation_failed' } }));
    const res = await fetchWithRetry('/x');
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
