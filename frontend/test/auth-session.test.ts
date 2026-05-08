// Phase 1 gate tests for the save-building auth flow fix.
//
// Validates that getCurrentSession() and authHeader() share a single source
// of truth and behave correctly when:
//   1. Supabase has a live session (authed user)
//   2. Supabase has no session (anonymous user)
//   3. Supabase client construction throws (missing env, etc.)
//
// authHeader() is exercised against the same mock to prove the two helpers
// can never disagree about auth state — that drift was the original bug.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/browser', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '@/lib/supabase/browser';
import { getCurrentSession } from '@/lib/auth/session';
import { authHeader } from '@/lib/api/backend';

type MaybeSession = { access_token: string; user: { id: string } } | null;

function mockSupabaseSession(session: MaybeSession): void {
  vi.mocked(createClient).mockReturnValue({
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session } }),
    },
  } as never);
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getCurrentSession', () => {
  it('returns the session when Supabase has one', async () => {
    const session = { access_token: 'token-abc', user: { id: 'u1' } };
    mockSupabaseSession(session);

    const result = await getCurrentSession();
    expect(result).toEqual(session);
  });

  it('returns null when Supabase has no session', async () => {
    mockSupabaseSession(null);

    const result = await getCurrentSession();
    expect(result).toBeNull();
  });

  it('logs and returns null when createClient throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(createClient).mockImplementation(() => {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
    });

    const result = await getCurrentSession();

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[auth/session] getCurrentSession failed',
      expect.any(Error),
    );
  });
});

describe('authHeader', () => {
  it('returns Bearer header when getCurrentSession returns a session', async () => {
    mockSupabaseSession({ access_token: 'token-xyz', user: { id: 'u2' } });

    const headers = await authHeader();
    expect(headers).toEqual({ Authorization: 'Bearer token-xyz' });
  });

  it('returns empty headers when there is no session', async () => {
    mockSupabaseSession(null);

    const headers = await authHeader();
    expect(headers).toEqual({});
  });

  it('returns empty headers when getCurrentSession fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(createClient).mockImplementation(() => {
      throw new Error('boom');
    });

    const headers = await authHeader();
    expect(headers).toEqual({});
  });
});
