// Phase 11 follow-up regression test: rate-limit must run AFTER body
// validation on /v1/lookup so malformed-JSON spam doesn't burn the
// per-anon-token quota (anon: 10/hr).
//
// Before the fix, app.ts mounted rateLimitMiddleware before any body
// validation. The validate step lived inside the handler, which runs
// AFTER middleware. Net: a script POSTing `{}` 11× from the same
// anon_token would get 10× 400 + 1× 429 — and a legitimate lookup from
// that anon would also be rate-limited.
//
// After the fix, validateLookupBodyMiddleware is mounted ahead of
// rateLimitMiddleware. Malformed JSON → 400 envelope with NO bucket
// increment, so subsequent valid requests still have quota.

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';

vi.mock('../src/db/client.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
        returning: async () => [],
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
          orderBy: () => ({ limit: async () => [] }),
        }),
      }),
    }),
  }),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));

let createApp: typeof import('../src/app.js').createApp;

beforeAll(async () => {
  ({ createApp } = await import('../src/app.js'));
});

afterEach(() => {
  // The rate-limit module owns a process-global Map keyed by anon_token.
  // Each test below uses a unique cookie value to keep its bucket isolated
  // — no module-reset needed.
});

function cookieFor(anonToken: string): string {
  return `rentguard-anon=${anonToken}`;
}

type Envelope = { error?: { code?: string } };

describe('lookup pre-handler validation runs before rate-limit', () => {
  it('20 malformed POSTs do not exhaust the anon /v1/lookup quota', async () => {
    const app = createApp();
    const anon = `test-anon-${crypto.randomUUID()}`;
    const headers = {
      'Content-Type': 'application/json',
      Cookie: cookieFor(anon),
    };

    // Fire 20 malformed bodies (>2x the anon limit of 10/hr). Each must
    // come back as validation_failed (400), not rate_limited (429).
    for (let i = 0; i < 20; i++) {
      const res = await app.request('/v1/lookup', {
        method: 'POST',
        headers,
        body: '{}',
      });
      expect(res.status, `request #${i + 1} should still be validation_failed`).toBe(400);
      const body = (await res.json()) as Envelope;
      expect(body.error?.code).toBe('validation_failed');
    }
  });

  it('malformed-JSON spam followed by a valid request still has quota', async () => {
    const app = createApp();
    const anon = `test-anon-${crypto.randomUUID()}`;
    const headers = {
      'Content-Type': 'application/json',
      Cookie: cookieFor(anon),
    };

    // Burn 15 malformed requests from this anon.
    for (let i = 0; i < 15; i++) {
      const res = await app.request('/v1/lookup', {
        method: 'POST',
        headers,
        body: '{ this is not json',
      });
      expect(res.status).toBe(400);
    }

    // Now a SCHEMA-valid request from the same anon. It does not have to
    // succeed end-to-end (the lookup pipeline depends on lots of services
    // we don't mock here); it just must NOT be rejected with 429.
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers,
      body: JSON.stringify({ address: '350 W 30th St' }),
    });
    expect(res.status, 'valid lookup should not be rate-limited').not.toBe(429);
    if (res.status === 400 || res.status === 500) {
      // Any error must NOT be rate_limited — that is the regression we
      // are guarding against. validation_failed / server_error are fine.
      const body = (await res.json()) as Envelope;
      expect(body.error?.code).not.toBe('rate_limited');
    }
  });
});
