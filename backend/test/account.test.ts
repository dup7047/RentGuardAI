// Phase 11.7: account-deletion endpoint tests.
//
// Pattern mirrors saved-buildings.test.ts: real Hono app, real auth, mocked
// DB layer. We capture updates against profiles via the mock so we can
// assert the deletion_requested_at field was set / cleared.

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { SignJWT } from 'jose';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    profileUpdates: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('../src/db/client.js', () => ({
  getDb: () => ({
    update: () => ({
      set: (values: Record<string, unknown>) => {
        mocks.profileUpdates.push(values);
        return {
          where: async () => undefined,
        };
      },
    }),
  }),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));

const sendEmail = vi.fn().mockResolvedValue({ ok: true, id: 'fake-id' });
vi.mock('../src/lib/email.js', () => ({
  sendEmail: (...args: unknown[]) => sendEmail(...args),
}));

const TEST_JWT_SECRET = 'test-jwt-secret-for-supabase-auth-32chars';
const TEST_UNDO_SECRET = 'test-undo-secret-needs-at-least-32-chars-yep';
const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';

let createApp: typeof import('../src/app.js').createApp;

beforeAll(async () => {
  process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.ACCOUNT_UNDO_SECRET = TEST_UNDO_SECRET;
  ({ createApp } = await import('../src/app.js'));
});

beforeEach(() => {
  mocks.profileUpdates = [];
  sendEmail.mockClear();
});

async function signSupabaseToken(): Promise<string> {
  const secret = new TextEncoder().encode(TEST_JWT_SECRET);
  return await new SignJWT({ sub: TEST_USER_ID, email: 'test@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setAudience('authenticated')
    .setIssuer('http://localhost:54321/auth/v1')
    .setExpirationTime('1h')
    .sign(secret);
}

describe('DELETE /v1/account', () => {
  it('returns 401 when unauthenticated, with the envelope shape', async () => {
    const app = createApp();
    const res = await app.request('/v1/account', { method: 'DELETE' });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('unauthorized');
    expect(mocks.profileUpdates).toHaveLength(0);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sets deletion_requested_at and sends the undo email', async () => {
    const app = createApp();
    const token = await signSupabaseToken();
    const res = await app.request('/v1/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(mocks.profileUpdates).toHaveLength(1);
    expect(mocks.profileUpdates[0]?.deletionRequestedAt).toBeInstanceOf(Date);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const sendArgs = sendEmail.mock.calls[0]?.[0] as { to: string; subject: string; html: string };
    expect(sendArgs.to).toBe('test@example.com');
    expect(sendArgs.subject).toMatch(/scheduled for deletion/i);
    // The undo URL must include the token query param so the link works
    // on a fresh device without re-auth.
    expect(sendArgs.html).toMatch(/\/account\/undo-delete\?token=/);
  });
});

describe('Acceptance: login still works after deletion (no immediate purge in v7)', () => {
  // The roadmap explicitly requires this: marking an account for deletion
  // must NOT immediately log the user out or block subsequent /v1/* requests
  // — only the cron in Phase 15.1 will actually purge data. We verify that
  // an authed call still succeeds after the deletion timestamp is set.
  it('a saved-buildings call after DELETE /v1/account still returns 200', async () => {
    const app = createApp();
    const token = await signSupabaseToken();

    const del = await app.request('/v1/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(200);

    // Now call an authed endpoint with the SAME token. The mocked DB
    // returns empty rows, but the route reaches the DB query (no 401)
    // — proving the deletion timestamp does not block authentication.
    const after = await app.request('/v1/saved-buildings', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(200);
    const body = (await after.json()) as { error?: unknown; items?: unknown };
    expect(body.error).toBeUndefined();
    expect(Array.isArray(body.items)).toBe(true);
  });
});

describe('POST /v1/account/undo-delete', () => {
  it('rejects an empty body with validation_failed', async () => {
    const app = createApp();
    const res = await app.request('/v1/account/undo-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('validation_failed');
  });

  it('rejects an invalid/expired token with validation_failed', async () => {
    const app = createApp();
    const res = await app.request('/v1/account/undo-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'not.a.real.jwt' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('validation_failed');
  });

  it('clears deletion_requested_at for a valid undo token', async () => {
    // Mint a real undo token via the same flow the DELETE handler uses.
    const secret = new TextEncoder().encode(TEST_UNDO_SECRET);
    const token = await new SignJWT({ purpose: 'undo-delete' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(TEST_USER_ID)
      .setIssuedAt()
      .setExpirationTime('30 days')
      .sign(secret);

    const app = createApp();
    const res = await app.request('/v1/account/undo-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; restored?: boolean };
    expect(body.ok).toBe(true);
    expect(body.restored).toBe(true);
    expect(mocks.profileUpdates).toHaveLength(1);
    expect(mocks.profileUpdates[0]?.deletionRequestedAt).toBeNull();
  });
});
