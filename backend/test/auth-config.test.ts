import { afterEach, describe, expect, it, vi } from 'vitest';

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
});
