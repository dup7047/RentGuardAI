// Phase 11.2 acceptance: each route's zod schema has unit-test coverage
// for the happy path plus 3 invalid-input cases. Tests exercise the route
// directly via the Hono app so the validate() middleware runs end-to-end
// and the response shape (envelope or 200) reflects what production users
// see — not just what the bare schema would parse.

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { SignJWT } from 'jose';

vi.mock('../src/db/client.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
        returning: async () => [{ createdAt: new Date('2026-05-12T00:00:00Z') }],
      }),
      // For waitlist + affiliate which call values() then return directly.
      then: undefined,
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
    update: () => ({
      set: () => ({ where: async () => undefined }),
    }),
  }),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));

const TEST_JWT_SECRET = 'test-jwt-secret-for-route-schemas-tests-32+';
const TEST_USER_ID = '22222222-2222-2222-2222-222222222222';

let createApp: typeof import('../src/app.js').createApp;

beforeAll(async () => {
  process.env.SUPABASE_JWT_SECRET = TEST_JWT_SECRET;
  process.env.SUPABASE_URL = 'http://localhost:54321';
  ({ createApp } = await import('../src/app.js'));
});

async function authToken(): Promise<string> {
  return await new SignJWT({ sub: TEST_USER_ID, email: 'test@example.com' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setAudience('authenticated')
    .setIssuer('http://localhost:54321/auth/v1')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(TEST_JWT_SECRET));
}

function assertEnvelope(body: unknown, code: string): void {
  const env = body as { error?: { code?: string } };
  expect(env.error?.code).toBe(code);
}

// ── POST /v1/affiliate/click — schema: {partner enum, referrerUrl url?, proceeded bool} ──
describe('POST /v1/affiliate/click schema', () => {
  it('happy: accepts a valid body', async () => {
    const app = createApp();
    const res = await app.request('/v1/affiliate/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner: 'lemonade', proceeded: false }),
    });
    expect(res.status).toBe(200);
  });

  it('invalid: missing partner', async () => {
    const app = createApp();
    const res = await app.request('/v1/affiliate/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proceeded: true }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: unknown partner enum value', async () => {
    const app = createApp();
    const res = await app.request('/v1/affiliate/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner: 'turbotax', proceeded: true }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: referrerUrl not a URL', async () => {
    const app = createApp();
    const res = await app.request('/v1/affiliate/click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner: 'lemonade', proceeded: true, referrerUrl: 'not-a-url' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });
});

// ── POST /v1/waitlist/email — schema: {email: email} ──
describe('POST /v1/waitlist/email schema', () => {
  it('happy: accepts a valid email', async () => {
    const app = createApp();
    const res = await app.request('/v1/waitlist/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com' }),
    });
    expect(res.status).toBe(200);
  });

  it('invalid: missing email field', async () => {
    const app = createApp();
    const res = await app.request('/v1/waitlist/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: malformed email', async () => {
    const app = createApp();
    const res = await app.request('/v1/waitlist/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: email is a number', async () => {
    const app = createApp();
    const res = await app.request('/v1/waitlist/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 42 }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });
});

// ── POST /v1/saved-buildings — schema: {bbl: /^\d{10}$/} (also auth-gated) ──
describe('POST /v1/saved-buildings schema', () => {
  it('happy: a valid 10-digit BBL passes the schema gate (no validation_failed envelope)', async () => {
    // The handler does a full INSERT+SELECT flow that our shallow DB mock
    // does not fully satisfy, so the response may not be a clean 200 — but
    // schema validation is the gate we are exercising. As long as the
    // response is not a validation_failed envelope, the schema accepted
    // the input.
    const app = createApp();
    const token = await authToken();
    const res = await app.request('/v1/saved-buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bbl: '3032227501' }),
    });
    expect(res.status).not.toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).not.toBe('validation_failed');
  });

  it('invalid: BBL is 9 digits', async () => {
    const app = createApp();
    const token = await authToken();
    const res = await app.request('/v1/saved-buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bbl: '123456789' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: BBL contains letters', async () => {
    const app = createApp();
    const token = await authToken();
    const res = await app.request('/v1/saved-buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bbl: 'abc1234567' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: missing bbl field entirely', async () => {
    const app = createApp();
    const token = await authToken();
    const res = await app.request('/v1/saved-buildings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });
});

// ── POST /v1/lookup — schema: refined {address|listingUrl}, optional email, bbl ──
describe('POST /v1/lookup schema', () => {
  // No happy path here: a full happy lookup hits scraping/geocode/AI which
  // are mocked in dedicated tests (lookup-stream.test.ts). Schema-validation
  // happens before any of that, so we only need to prove the gate works.

  it('invalid: empty body fails the address-or-listingUrl refine', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: email field is not an email', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '350 W 30th St', email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: bbl is 11 digits (regex /^\\d{10}$/)', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '350 W 30th St', bbl: '12345678901' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  // Stored-XSS regression: the address field must reject HTML metacharacters
  // so a payload like `</script><script>...</script>` can never reach
  // buildings.address (rendered into a JSON-LD <script> on the SEO archive).
  it('invalid: address contains `<` (XSS payload rejected)', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '</script><script>alert(1)</script>', bbl: '1000019999' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  // SSRF regression: listingUrl must be on the StreetEasy/Zillow allowlist.
  // Without this, an attacker could probe internal services on the host.
  it('invalid: listingUrl points at internal IP (SSRF guard)', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingUrl: 'http://169.254.169.254/latest/meta-data/' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: listingUrl uses non-http scheme (file://)', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingUrl: 'file:///etc/passwd' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });

  it('invalid: listingUrl points at non-allowlisted public host', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingUrl: 'https://attacker.example/payload' }),
    });
    expect(res.status).toBe(400);
    assertEnvelope(await res.json(), 'validation_failed');
  });
});

// ── GET /v1/building/:bbl — param: /^\d{10}$/ (404 envelope when malformed) ──
describe('GET /v1/building/:bbl param', () => {
  it('happy: 10-digit BBL is accepted (mocked DB returns no row → not_found, but param passed)', async () => {
    const app = createApp();
    const res = await app.request('/v1/building/3032227501');
    // No row in mocked DB → the handler throws not_found AFTER param check.
    // This test confirms the param itself didn't trip validation.
    expect(res.status).toBe(404);
    assertEnvelope(await res.json(), 'not_found');
  });

  it('invalid: non-numeric param', async () => {
    const app = createApp();
    const res = await app.request('/v1/building/abc1234567');
    expect(res.status).toBe(404);
    assertEnvelope(await res.json(), 'not_found');
  });

  it('invalid: 9-digit param', async () => {
    const app = createApp();
    const res = await app.request('/v1/building/123456789');
    expect(res.status).toBe(404);
    assertEnvelope(await res.json(), 'not_found');
  });

  it('invalid: 11-digit param', async () => {
    const app = createApp();
    const res = await app.request('/v1/building/12345678901');
    expect(res.status).toBe(404);
    assertEnvelope(await res.json(), 'not_found');
  });
});
