'use server';

import { createClient } from '@/lib/supabase/server';

// Server-side BACKEND base — duplicated from lib/api/backend.ts because that
// module pulls in client-only deps (Supabase browser client) when imported
// from a server action.
const PROD_BACKEND_URL = 'https://rentguardai.onrender.com';
const DEV_BACKEND_URL = 'http://localhost:8080';
const BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  (process.env.NODE_ENV === 'production' ? PROD_BACKEND_URL : DEV_BACKEND_URL);

// Resolve the Supabase access token server-side. Reading the session here goes
// through @/lib/supabase/server, which parses raw HTTP cookies — unlike the
// browser client's getSession(), which throws "The string did not match the
// expected pattern" on Safari when chunked auth cookies span the size limit.
// That browser bug is what was making the save-building modal pop up for
// already-signed-in users on /building/[bbl] (see BuildingReport.tsx).
async function getAccessToken(): Promise<string | null> {
  try {
    const supabase = await createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

export type SavedStateResult =
  | { kind: 'ok'; saved: boolean }
  | { kind: 'unauthorized' }
  | { kind: 'error' };

export type SaveResult =
  | { kind: 'ok' }
  | { kind: 'unauthorized' }
  | { kind: 'error' };

const BBL_RE = /^\d{10}$/;

export async function getSavedBuildingStateAction(
  bbl: string,
): Promise<SavedStateResult> {
  if (!BBL_RE.test(bbl)) return { kind: 'error' };
  const token = await getAccessToken();
  if (!token) return { kind: 'unauthorized' };

  try {
    const res = await fetch(`${BASE}/v1/saved-buildings/${bbl}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    if (res.status === 401) return { kind: 'unauthorized' };
    if (!res.ok) return { kind: 'error' };
    const body = (await res.json()) as { saved: boolean };
    return { kind: 'ok', saved: Boolean(body.saved) };
  } catch {
    return { kind: 'error' };
  }
}

export async function saveBuildingAction(bbl: string): Promise<SaveResult> {
  if (!BBL_RE.test(bbl)) return { kind: 'error' };
  const token = await getAccessToken();
  if (!token) return { kind: 'unauthorized' };

  try {
    const res = await fetch(`${BASE}/v1/saved-buildings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ bbl }),
    });
    if (res.status === 401) return { kind: 'unauthorized' };
    if (!res.ok) return { kind: 'error' };
    return { kind: 'ok' };
  } catch {
    return { kind: 'error' };
  }
}

export async function unsaveBuildingAction(bbl: string): Promise<SaveResult> {
  if (!BBL_RE.test(bbl)) return { kind: 'error' };
  const token = await getAccessToken();
  if (!token) return { kind: 'unauthorized' };

  try {
    const res = await fetch(`${BASE}/v1/saved-buildings/${bbl}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 401) return { kind: 'unauthorized' };
    if (!res.ok) return { kind: 'error' };
    return { kind: 'ok' };
  } catch {
    return { kind: 'error' };
  }
}
