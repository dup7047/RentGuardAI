// Phase 11.2 acceptance: every /v1/* route returns the standardized error
// envelope on malformed input (and on rate-limit / auth / not-found failures
// where applicable). Envelope shape: {error: {code, message, requestId}}.
//
// Per the streaming-endpoint caveat in src/lib/errors.ts, pre-stream failures
// also return the envelope as plain JSON (verified in lookup-stream.test.ts).
//
// We mock the DB layer (no real Postgres needed) and skip business-outcome
// paths — only the error path is exercised here.

import { describe, it, expect, vi, beforeAll } from 'vitest';

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
    delete: () => ({ where: async () => undefined }),
  }),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));

let createApp: typeof import('../src/app.js').createApp;

beforeAll(async () => {
  ({ createApp } = await import('../src/app.js'));
});

type Envelope = { error?: { code?: string; message?: string; requestId?: string } };

function assertEnvelope(body: unknown, code: string): void {
  const env = body as Envelope;
  expect(env.error?.code).toBe(code);
  expect(typeof env.error?.message).toBe('string');
  expect(typeof env.error?.requestId).toBe('string');
}

describe('error envelope contract', () => {
  it('POST /v1/lookup malformed body → validation_failed', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('POST /v1/affiliate/click malformed body → validation_failed', async () => {
    const app = createApp();
    const res = await app.request('/v1/affiliate/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('POST /v1/waitlist/email malformed body → validation_failed', async () => {
    const app = createApp();
    const res = await app.request('/v1/waitlist/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('POST /v1/saved-buildings (no auth) → unauthorized', async () => {
    const app = createApp();
    const res = await app.request('/v1/saved-buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbl: '3032227501' }),
    });
    expect(res.status).toBe(401);
    assertEnvelope(await res.json(), 'unauthorized');
  });

  it('GET /v1/building/:bbl unknown BBL → not_found', async () => {
    const app = createApp();
    const res = await app.request('/v1/building/9999999999');
    expect(res.status).toBe(404);
    assertEnvelope(await res.json(), 'not_found');
  });

  it('response includes X-Request-Id header matching requestId in body', async () => {
    const app = createApp();
    const res = await app.request('/v1/affiliate/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const requestId = res.headers.get('X-Request-Id');
    expect(requestId).toBeTruthy();
    const body = (await res.json()) as Envelope;
    expect(body.error?.requestId).toBe(requestId);
  });
});
