'use server';

import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';
import type { SavedBuilding } from '@/lib/api/backend';

// Server-side BACKEND base — duplicated from lib/api/backend.ts because that
// module pulls in client-only deps (Supabase browser client) when imported
// from a server action.
const PROD_BACKEND_URL = 'https://rentguardai.onrender.com';
const DEV_BACKEND_URL = 'http://localhost:8080';
const BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  (process.env.NODE_ENV === 'production' ? PROD_BACKEND_URL : DEV_BACKEND_URL);

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();

  redirect('/login?loggedOut=1');
}

// Resolve a Supabase access token server-side. Logs on null so we can tell
// from prod logs whether a 401 from /v1/saved-buildings is "no token sent"
// (Safari cookie parsing returns null session here) vs "backend rejected
// token" (token was sent but backend's JWT verifier said no). Pair this with
// the backend's `reason` log line from auth middleware to identify root cause.
async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      console.warn('[dashboard] getAccessToken returned null', {
        hasSession: Boolean(session),
        error: error?.message,
      });
      return null;
    }
    return session.access_token;
  } catch {
    return null;
  }
}

export type SavedBuildingsLoad =
  | { kind: 'ok'; items: SavedBuilding[] }
  | { kind: 'unauthorized' }
  | { kind: 'error' };

// Fetch the signed-in user's saved-buildings list server-side. Doing this in
// a server action (instead of a client fetch via Supabase browser client)
// avoids fragile client-side cookie/JWT decoding paths — Safari in particular
// throws "The string did not match the expected pattern" from the Supabase
// chunked-cookie decode when sessions span the cookie size limit.
//
// The caller (DashboardPage) already loads the user via getUser() and has
// the session in hand — passing the token in lets us skip a redundant
// Supabase round-trip on every dashboard render.
export async function loadSavedBuildings(token: string): Promise<SavedBuildingsLoad> {
  if (!token) return { kind: 'unauthorized' };

  try {
    const res = await fetch(`${BASE}/v1/saved-buildings`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
      // 30 s hard cap — Render free-tier cold starts routinely take
      // 20-40 s. Without a timeout the request hangs indefinitely and
      // <main> stays blank; with too short a timeout users hit the
      // error card on every cold boot.
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) {
      // Token was sent but the backend rejected it. Most likely cause: the
      // backend's SUPABASE_URL/JWT_SECRET don't match the Supabase project
      // the frontend is signed into (the auth middleware logs `reason` for
      // every rejection — check Render logs to confirm bad_iss vs expired).
      console.warn(
        '[dashboard] backend rejected access token (401) — check Render auth logs for reason',
      );
      return { kind: 'unauthorized' };
    }
    if (!res.ok) return { kind: 'error' };
    const body = (await res.json()) as { items: SavedBuilding[]; total_count: number };
    return { kind: 'ok', items: body.items };
  } catch {
    return { kind: 'error' };
  }
}

export type DeleteAccountResult =
  | { ok: true; deletion_requested_at: string }
  | { ok: false; reason: 'auth' | 'error' };

// Phase 11.7: marks the authed user for deletion via DELETE /v1/account.
// The backend stamps profiles.deletion_requested_at and emails a 30-day
// undo link; this server action only forwards the call and surfaces the
// result. The purge cron lands in Phase 15.1.
export async function deleteAccountAction(): Promise<DeleteAccountResult> {
  const token = await getAccessToken();
  if (!token) return { ok: false, reason: 'auth' };

  try {
    const res = await fetch(`${BASE}/v1/account`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401) return { ok: false, reason: 'auth' };
    if (!res.ok) return { ok: false, reason: 'error' };
    const body = (await res.json()) as { ok: boolean; deletion_requested_at: string };
    return { ok: true, deletion_requested_at: body.deletion_requested_at };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export type UndoDeleteResult = { ok: true } | { ok: false; reason: 'invalid_token' | 'error' };

// Phase 11.7: clears profiles.deletion_requested_at given a valid undo JWT.
// Used by /account/undo-delete page (no auth required — possession of the
// signed token is the authorization).
export async function undoDeleteAction(token: string): Promise<UndoDeleteResult> {
  if (!token) return { ok: false, reason: 'invalid_token' };
  try {
    const res = await fetch(`${BASE}/v1/account/undo-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    if (res.status === 400) return { ok: false, reason: 'invalid_token' };
    if (!res.ok) return { ok: false, reason: 'error' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export type UnsaveResult = { ok: true } | { ok: false; reason: 'auth' | 'error' };

export async function unsaveBuildingAction(bbl: string): Promise<UnsaveResult> {
  if (!/^\d{10}$/.test(bbl)) return { ok: false, reason: 'error' };

  const token = await getAccessToken();
  if (!token) return { ok: false, reason: 'auth' };

  try {
    const res = await fetch(`${BASE}/v1/saved-buildings/${bbl}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401) return { ok: false, reason: 'auth' };
    if (!res.ok) return { ok: false, reason: 'error' };
    return { ok: true };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
