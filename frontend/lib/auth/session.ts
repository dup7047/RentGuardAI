'use client';

import type { Session } from '@supabase/supabase-js';

import { createClient } from '@/lib/supabase/browser';

// Single source of truth for "is the user signed in, and what's their access
// token?" Both authHeader() (network-side) and BuildingReport (UI-side) call
// this so they cannot disagree about auth state — that drift was the cause of
// the original "save building prompts for sign-in even when authed" bug.
//
// Returns null on any failure (missing env, throw inside Supabase client,
// rejected promise). Logs at warn so a missing-env footgun in production is
// at least visible in the browser console; the caller still treats null as
// "anonymous" and lets the existing SignInModal flow run.
export async function getCurrentSession(): Promise<Session | null> {
  try {
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    // Diagnostic: log when cookies are present but no session was parsed —
    // the Safari "signed in but save still prompts" failure mode. Skipped
    // for genuinely-anonymous users (no cookies → null is expected) so logs
    // don't drown in noise.
    if (!session && typeof document !== 'undefined' && document.cookie.length > 0) {
      console.warn('[auth/session] getSession returned null despite cookies present', {
        cookieLength: document.cookie.length,
      });
    }
    return session;
  } catch (err) {
    console.warn('[auth/session] getCurrentSession failed', err);
    return null;
  }
}
