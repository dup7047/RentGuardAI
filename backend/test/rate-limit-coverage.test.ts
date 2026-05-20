// Regression coverage: the public, anonymous-accessible routes other than
// /v1/lookup are also rate-limited. Before this lived in app.ts, the
// building / affiliate-click / waitlist-email routes accepted unlimited
// anonymous requests — meaning an attacker could enumerate every NYC
// building (each cache-miss triggers 8 dataset fetches + an OpenAI call),
// spam affiliate rows, or fan-out arbitrary emails to Beehiiv.
//
// Per-route limits are different (reads are cheaper than writes; Beehiiv is
// strictest because abuse damages our sender reputation). The mock below
// emulates the Postgres-backed counter so each test can drive the route
// past its specific cap and see the 429.

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const mockRateLimitBuckets = new Map<string, number>();

vi.mock('../src/db/client.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: { key?: string; windowStart?: Date }) => ({
        onConflictDoNothing: async () => undefined,
        onConflictDoUpdate: () => ({
          returning: async () => {
            // Only the rate-limit middleware passes (key, windowStart);
            // every other insert site falls back to count=1 / not rate-limited.
            if (typeof v?.key === 'string' && v.windowStart) {
              const bucketKey = `${v.key}@${v.windowStart.getTime()}`;
              const next = (mockRateLimitBuckets.get(bucketKey) ?? 0) + 1;
              mockRateLimitBuckets.set(bucketKey, next);
              return [{ count: next }];
            }
            return [{ count: 1 }];
          },
        }),
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
    delete: () => ({ where: async () => undefined }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  }),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));

let createApp: typeof import('../src/app.js').createApp;

beforeAll(async () => {
  ({ createApp } = await import('../src/app.js'));
});

beforeEach(() => {
  mockRateLimitBuckets.clear();
});

function cookieFor(anonToken: string): string {
  return `rentguard-anon=${anonToken}`;
}

type Envelope = { error?: { code?: string } };

// ── /v1/building/:bbl — anonPerHour: 30 ──────────────────────────────────────
describe('GET /v1/building/:bbl rate limit', () => {
  it('30 requests pass, the 31st returns 429', async () => {
    const app = createApp();
    const anon = `bldg-${crypto.randomUUID()}`;
    const headers = { Cookie: cookieFor(anon) };

    // First 30 requests are allowed by the middleware. Handler may itself
    // return 404 (DB mock has no row), but the rate-limit gate has passed.
    for (let i = 0; i < 30; i++) {
      const res = await app.request('/v1/building/1000010001', { headers });
      expect(res.status, `request #${i + 1} should not be 429`).not.toBe(429);
    }

    // 31st request trips the limit.
    const res = await app.request('/v1/building/1000010001', { headers });
    expect(res.status).toBe(429);
    const body = (await res.json()) as Envelope;
    expect(body.error?.code).toBe('rate_limited');
  });
});

// ── POST /v1/affiliate/click — anonPerHour: 50 ───────────────────────────────
describe('POST /v1/affiliate/click rate limit', () => {
  it('50 requests pass, the 51st returns 429', async () => {
    const app = createApp();
    const anon = `aff-${crypto.randomUUID()}`;
    const headers = {
      'Content-Type': 'application/json',
      Cookie: cookieFor(anon),
    };
    const body = JSON.stringify({ partner: 'lemonade', proceeded: false });

    for (let i = 0; i < 50; i++) {
      const res = await app.request('/v1/affiliate/click', { method: 'POST', headers, body });
      expect(res.status, `request #${i + 1} should not be 429`).not.toBe(429);
    }

    const res = await app.request('/v1/affiliate/click', { method: 'POST', headers, body });
    expect(res.status).toBe(429);
    const envelope = (await res.json()) as Envelope;
    expect(envelope.error?.code).toBe('rate_limited');
  });
});

// ── POST /v1/waitlist/email — anonPerHour: 10 ────────────────────────────────
describe('POST /v1/waitlist/email rate limit', () => {
  it('10 requests pass, the 11th returns 429', async () => {
    const app = createApp();
    const anon = `wl-${crypto.randomUUID()}`;
    const headers = {
      'Content-Type': 'application/json',
      Cookie: cookieFor(anon),
    };
    const body = JSON.stringify({ email: 'user@example.com' });

    for (let i = 0; i < 10; i++) {
      const res = await app.request('/v1/waitlist/email', { method: 'POST', headers, body });
      expect(res.status, `request #${i + 1} should not be 429`).not.toBe(429);
    }

    const res = await app.request('/v1/waitlist/email', { method: 'POST', headers, body });
    expect(res.status).toBe(429);
    const envelope = (await res.json()) as Envelope;
    expect(envelope.error?.code).toBe('rate_limited');
  });
});

// ── Per-route counter isolation ──────────────────────────────────────────────
describe('per-route counters are independent', () => {
  it('exhausting waitlist (10/h) does not affect affiliate quota (50/h)', async () => {
    const app = createApp();
    const anon = `iso-${crypto.randomUUID()}`;
    const headers = {
      'Content-Type': 'application/json',
      Cookie: cookieFor(anon),
    };

    // Exhaust waitlist quota.
    for (let i = 0; i < 11; i++) {
      await app.request('/v1/waitlist/email', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: 'user@example.com' }),
      });
    }
    const waitlistOverflow = await app.request('/v1/waitlist/email', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'user@example.com' }),
    });
    expect(waitlistOverflow.status).toBe(429);

    // Affiliate is unaffected — different `name` key in the counter table.
    const affRes = await app.request('/v1/affiliate/click', {
      method: 'POST',
      headers,
      body: JSON.stringify({ partner: 'lemonade', proceeded: false }),
    });
    expect(affRes.status).not.toBe(429);
  });
});

// ── Body-validation runs before rate-limit ────────────────────────────────────
// Same invariant as lookup-rate-limit-ordering.test.ts but applied to the
// newly-protected POST routes — malformed JSON shouldn't burn quota.
describe('validation runs before rate-limit on new routes', () => {
  it('30 invalid /v1/affiliate/click bodies do not burn the 50/h quota', async () => {
    const app = createApp();
    const anon = `aff-pre-${crypto.randomUUID()}`;
    const headers = {
      'Content-Type': 'application/json',
      Cookie: cookieFor(anon),
    };

    // 30 invalid bodies (partner is required) → each 400, no counter increment.
    for (let i = 0; i < 30; i++) {
      const res = await app.request('/v1/affiliate/click', {
        method: 'POST',
        headers,
        body: JSON.stringify({ proceeded: false }),
      });
      expect(res.status).toBe(400);
    }

    // First valid body should still pass.
    const valid = await app.request('/v1/affiliate/click', {
      method: 'POST',
      headers,
      body: JSON.stringify({ partner: 'lemonade', proceeded: false }),
    });
    expect(valid.status).not.toBe(429);
  });
});
