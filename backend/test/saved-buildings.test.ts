// /v1/saved-buildings tests.
//
// Pattern:
//   - Real Hono app via createApp(), real auth middleware (jose.jwtVerify),
//     real Zod validation. Mock only the DB layer.
//   - Sign a real JWT against SUPABASE_JWT_SECRET so the auth path runs
//     end-to-end. Avoids stubbing the auth middleware itself.
//
// Tests are added incrementally as endpoints land. Phase 2 covers
// GET /v1/saved-buildings/:bbl only.

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { SignJWT } from 'jose';
import { logger } from '../src/logger.js';

// ── Hoisted mock state for the DB ─────────────────────────────────────────
// vi.hoisted runs before vi.mock, so the factory closures below capture this
// reference. Per-test mutation of `mocks.*` controls what the next request
// sees from the DB.
const { mocks } = vi.hoisted(() => ({
  mocks: {
    // Per-call returned rows for SELECT chains.
    selectRows: [] as Array<Record<string, unknown>>,
    // Captures every INSERT … VALUES(...) call. Tests assert on shape.
    insertedValues: [] as Array<Record<string, unknown>>,
    // Whether the next ON CONFLICT DO NOTHING insert returns a fresh row
    // (true) or empty (false, simulating a conflict).
    insertReturnsRow: true,
    // saved_at returned from the insert when insertReturnsRow is true. When
    // it's false (conflict), the follow-up SELECT in the route uses
    // selectRows, so tests can configure the existing row's createdAt there.
    insertCreatedAt: new Date('2026-05-01T12:00:00Z'),
    // Counter for DELETE calls — tests assert the route reached the DB.
    deleteCalls: 0,
    // Per-call queue of pool.query results. The list endpoint runs two
    // queries (rows + count); push two entries per request in test order.
    poolQueryQueue: [] as Array<{ rows: Array<Record<string, unknown>> }>,
  },
}));

vi.mock('../src/db/client.js', () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.selectRows,
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mocks.insertedValues.push(v);
        return {
          onConflictDoNothing: () => ({
            returning: async () =>
              mocks.insertReturnsRow ? [{ createdAt: mocks.insertCreatedAt }] : [],
          }),
        };
      },
    }),
    delete: () => ({
      where: async () => {
        mocks.deleteCalls += 1;
      },
    }),
  }),
  getPool: () => ({
    query: async () => mocks.poolQueryQueue.shift() ?? { rows: [] },
  }),
}));

const TEST_SECRET = 'test-jwt-secret-saved-buildings';
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';

let createApp: typeof import('../src/app.js').createApp;

beforeAll(async () => {
  process.env.SUPABASE_JWT_SECRET = TEST_SECRET;
  process.env.SUPABASE_URL = 'http://localhost:54321';
  // Import after env vars are set so the auth middleware sees them on first call.
  ({ createApp } = await import('../src/app.js'));
});

beforeEach(() => {
  mocks.selectRows = [];
  mocks.insertedValues = [];
  mocks.insertReturnsRow = true;
  mocks.insertCreatedAt = new Date('2026-05-01T12:00:00Z');
  mocks.deleteCalls = 0;
  mocks.poolQueryQueue = [];
});

async function signToken(userId = TEST_USER_ID): Promise<string> {
  const secret = new TextEncoder().encode(TEST_SECRET);
  return await new SignJWT({ sub: userId, email: 'user@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setAudience('authenticated')
    .setIssuer('http://localhost:54321/auth/v1')
    .setExpirationTime('1h')
    .sign(secret);
}

describe('GET /v1/saved-buildings/:bbl', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const app = createApp();
    const res = await app.request('/v1/saved-buildings/3032227501');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { kind: string };
    expect(body.kind).toBe('unauthorized');
  });

  it('returns 401 when the token is invalid', async () => {
    const app = createApp();
    const res = await app.request('/v1/saved-buildings/3032227501', {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for a non-10-digit BBL', async () => {
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings/abc', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { kind: string };
    expect(body.kind).toBe('invalid_input');
  });

  it('returns { saved: false } when no row exists for this user + BBL', async () => {
    mocks.selectRows = [];
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings/3032227501', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean };
    expect(body).toEqual({ saved: false });
  });

  it('returns { saved: true, saved_at } when a row exists', async () => {
    const savedAt = new Date('2026-05-01T12:00:00Z');
    mocks.selectRows = [{ createdAt: savedAt }];
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings/3032227501', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean; saved_at: string };
    expect(body.saved).toBe(true);
    expect(body.saved_at).toBe(savedAt.toISOString());
  });
});

describe('POST /v1/saved-buildings', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const app = createApp();
    const res = await app.request('/v1/saved-buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbl: '3032227501' }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 when body bbl is invalid', async () => {
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bbl: 'not-a-bbl' }),
    });
    expect(res.status).toBe(400);
  });

  it('saves a fresh BBL and returns saved_at from the insert', async () => {
    const insertCreatedAt = new Date('2026-05-08T09:00:00Z');
    mocks.insertReturnsRow = true;
    mocks.insertCreatedAt = insertCreatedAt;

    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bbl: '3032227501' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean; saved_at: string };
    expect(body.saved).toBe(true);
    expect(body.saved_at).toBe(insertCreatedAt.toISOString());
    // The route inserts twice: first an ensure-profile upsert (so the
    // saved_buildings FK to profiles always resolves), then the saved row.
    expect(mocks.insertedValues).toEqual([
      { id: TEST_USER_ID, email: 'user@example.com' },
      { userId: TEST_USER_ID, bbl: '3032227501' },
    ]);
  });

  it('is idempotent: re-saving an existing BBL returns the original saved_at via the follow-up SELECT', async () => {
    const originalCreatedAt = new Date('2026-04-15T10:00:00Z');
    // Simulate ON CONFLICT DO NOTHING → empty RETURNING
    mocks.insertReturnsRow = false;
    // Follow-up SELECT returns the existing row's createdAt
    mocks.selectRows = [{ createdAt: originalCreatedAt }];

    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bbl: '3032227501' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean; saved_at: string };
    expect(body.saved).toBe(true);
    expect(body.saved_at).toBe(originalCreatedAt.toISOString());
  });
});

describe('DELETE /v1/saved-buildings/:bbl', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const app = createApp();
    const res = await app.request('/v1/saved-buildings/3032227501', {
      method: 'DELETE',
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for a non-10-digit BBL', async () => {
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings/abc', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });

  it('deletes the row and returns { saved: false }', async () => {
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings/3032227501', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean };
    expect(body).toEqual({ saved: false });
    expect(mocks.deleteCalls).toBe(1);
  });

  it('is idempotent: deleting a non-existent row still returns { saved: false }', async () => {
    // The Drizzle delete chain doesn't error on zero affected rows; the
    // route's behavior is the same regardless. We assert the response shape.
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings/9999999999', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { saved: boolean };
    expect(body).toEqual({ saved: false });
  });
});

describe('GET /v1/saved-buildings (list)', () => {
  it('returns 401 when no Authorization header is present', async () => {
    const app = createApp();
    const res = await app.request('/v1/saved-buildings');
    expect(res.status).toBe(401);
  });

  it('returns empty list + total_count 0 when nothing is saved', async () => {
    mocks.poolQueryQueue = [
      { rows: [] }, // list query
      { rows: [{ total: '0' }] }, // count query
    ];
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; total_count: number };
    expect(body).toEqual({ items: [], total_count: 0 });
  });

  it('returns saved items with address, borough, score, and saved_at', async () => {
    const savedAt = new Date('2026-05-08T09:00:00Z');
    mocks.poolQueryQueue = [
      {
        rows: [
          {
            bbl: '3032227501',
            address: '149 Starr St',
            borough: 'BROOKLYN',
            saved_at: savedAt,
            score: 72,
            score_band: 'moderate',
          },
        ],
      },
      { rows: [{ total: '1' }] },
    ];
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        bbl: string;
        address: string;
        borough: string;
        saved_at: string;
        score: number;
        score_band: string;
      }>;
      total_count: number;
    };
    expect(body.total_count).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual({
      bbl: '3032227501',
      address: '149 Starr St',
      borough: 'BROOKLYN',
      saved_at: savedAt.toISOString(),
      score: 72,
      score_band: 'moderate',
    });
  });

  it('preserves the SQL row order returned by the pool (created_at DESC)', async () => {
    const newer = new Date('2026-05-08T09:00:00Z');
    const older = new Date('2026-04-15T09:00:00Z');
    mocks.poolQueryQueue = [
      {
        rows: [
          { bbl: '1111111111', address: 'A', borough: 'MANHATTAN', saved_at: newer, score: 50, score_band: 'minimal' },
          { bbl: '2222222222', address: 'B', borough: 'QUEENS', saved_at: older, score: 80, score_band: 'high' },
        ],
      },
      { rows: [{ total: '2' }] },
    ];
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = (await res.json()) as { items: Array<{ bbl: string }> };
    expect(body.items.map((i) => i.bbl)).toEqual(['1111111111', '2222222222']);
  });

  it('handles a row with null address/score (LEFT JOIN nulls) without crashing', async () => {
    const savedAt = new Date('2026-05-08T09:00:00Z');
    mocks.poolQueryQueue = [
      {
        rows: [
          {
            bbl: '3032227501',
            address: null,
            borough: null,
            saved_at: savedAt,
            score: null,
            score_band: null,
          },
        ],
      },
      { rows: [{ total: '1' }] },
    ];
    const app = createApp();
    const token = await signToken();
    const res = await app.request('/v1/saved-buildings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ address: null; score: null; score_band: null }>;
    };
    expect(body.items[0]).toMatchObject({ address: null, score: null, score_band: null });
  });
});

// ── Phase 2: auth middleware reason classification ─────────────────────────
//
// The original "save building prompts for sign-in even when authed" bug had
// a class of failure mode (issuer mismatch from a backend SUPABASE_URL that
// doesn't match the frontend's project) that the pre-existing tests could
// not catch — they sign tokens with the same issuer they verify against.
// These tests exercise the bad_iss / expired classifications and assert the
// log shape, so a future env-config regression is visible in CI and prod.
//
// Coverage of the happy path (valid token → userId reaches handler) is
// already explicit at lines 183-204: the POST test asserts
// `mocks.insertedValues` contains TEST_USER_ID, which proves the JWT `sub`
// claim flowed through the middleware into the route handler.

describe('auth middleware reason classification', () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => logger);
  });

  afterEach(() => {
    infoSpy.mockRestore();
  });

  it('rejects token signed with mismatched issuer and logs reason: bad_iss', async () => {
    const secret = new TextEncoder().encode(TEST_SECRET);
    const badIssToken = await new SignJWT({ sub: TEST_USER_ID })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setAudience('authenticated')
      .setIssuer('http://other-project.supabase.co/auth/v1')
      .setExpirationTime('1h')
      .sign(secret);

    const app = createApp();
    const res = await app.request('/v1/saved-buildings/3032227501', {
      headers: { Authorization: `Bearer ${badIssToken}` },
    });

    expect(res.status).toBe(401);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: 'bad_iss',
        expectedIss: 'http://localhost:54321/auth/v1',
        gotIss: 'http://other-project.supabase.co/auth/v1',
      }),
      'jwt verify failed — continuing as anon',
    );
  });

  it('rejects expired token and logs reason: expired', async () => {
    const secret = new TextEncoder().encode(TEST_SECRET);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiredToken = await new SignJWT({ sub: TEST_USER_ID })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(nowSeconds - 3600)
      .setAudience('authenticated')
      .setIssuer('http://localhost:54321/auth/v1')
      .setExpirationTime(nowSeconds - 60)
      .sign(secret);

    const app = createApp();
    const res = await app.request('/v1/saved-buildings/3032227501', {
      headers: { Authorization: `Bearer ${expiredToken}` },
    });

    expect(res.status).toBe(401);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'expired' }),
      'jwt verify failed — continuing as anon',
    );
  });
});
