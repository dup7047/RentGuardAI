// The anon token is compared against uuid-typed columns downstream
// (building_lookups.anon_token). A malformed cookie value used to flow
// through verbatim and turn every lookup from that browser into a 22P02
// 500 — the middleware must reissue a fresh UUID instead.

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
  }),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));

let createApp: typeof import('../src/app.js').createApp;

beforeAll(async () => {
  ({ createApp } = await import('../src/app.js'));
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function issuedToken(res: Response): string | null {
  const setCookie = res.headers.get('set-cookie') ?? '';
  const m = setCookie.match(/rentguard-anon=([^;]+)/);
  return m?.[1] ?? null;
}

describe('anonTokenMiddleware cookie validation', () => {
  it('reissues a UUID when the cookie value is not a UUID', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: 'rentguard-anon=seo:not-a-uuid',
      },
      body: '{}',
    });
    const token = issuedToken(res);
    expect(token).toBeTruthy();
    expect(token).toMatch(UUID_RE);
  });

  it('keeps a valid UUID cookie without reissuing', async () => {
    const app = createApp();
    const existing = 'a3f1c2d4-5678-4abc-9def-0123456789ab';
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `rentguard-anon=${existing}`,
      },
      body: '{}',
    });
    expect(issuedToken(res)).toBeNull();
  });
});
