import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';

const originalSupabaseUrl = process.env.SUPABASE_URL;
const originalSupabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;

afterEach(() => {
  if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalSupabaseUrl;

  if (originalSupabaseJwtSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
  else process.env.SUPABASE_JWT_SECRET = originalSupabaseJwtSecret;

  vi.resetModules();
});

describe('auth middleware env config', () => {
  it('boots without Supabase auth env vars and leaves protected routes anonymous', async () => {
    vi.resetModules();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_JWT_SECRET;

    const { createApp } = await import('../src/app.js');
    const app = createApp();

    const health = await app.request('/health');
    expect(health.status).toBe(200);

    const savedBuilding = await app.request('/v1/saved-buildings/3032227501', {
      headers: { Authorization: 'Bearer not-verified-without-config' },
    });
    expect(savedBuilding.status).toBe(401);
  });

  // Regression guard for the original bug class: when SUPABASE_URL is missing
  // in production, a frontend that's correctly signed-in still gets 401.
  // Existing test above only sends a malformed token; this one sends a token
  // with a valid JWT shape (correct iss/aud/secret) and asserts the missing
  // env var alone is enough to reject it. If anyone "fixes" the middleware
  // by allowing fallthrough verification, this test fails immediately.
  it('rejects a structurally-valid token when SUPABASE_URL is missing (no spurious 200s)', async () => {
    vi.resetModules();
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_JWT_SECRET =
      'super-secret-jwt-token-with-at-least-32-characters-long';

    const loggerModule = await import('../src/logger.js');
    const warnSpy = vi.spyOn(loggerModule.logger, 'warn');

    const { createApp } = await import('../src/app.js');

    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ missingSupabaseUrl: true }),
      'supabase jwt verification disabled; requests will continue as anonymous',
    );

    const secret = new TextEncoder().encode(
      process.env.SUPABASE_JWT_SECRET,
    );
    const token = await new SignJWT({ sub: 'user-1' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setAudience('authenticated')
      .setIssuer('http://localhost:54321/auth/v1')
      .setExpirationTime('1h')
      .sign(secret);

    const app = createApp();
    const res = await app.request('/v1/saved-buildings/3032227501', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);

    warnSpy.mockRestore();
  });
});
