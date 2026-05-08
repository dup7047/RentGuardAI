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

async function getAccessToken(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
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
export async function loadSavedBuildings(): Promise<SavedBuildingsLoad> {
  const token = await getAccessToken();
  if (!token) return { kind: 'unauthorized' };

  try {
    const res = await fetch(`${BASE}/v1/saved-buildings`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    if (res.status === 401) return { kind: 'unauthorized' };
    if (!res.ok) return { kind: 'error' };
    const body = (await res.json()) as { items: SavedBuilding[]; total_count: number };
    return { kind: 'ok', items: body.items };
  } catch {
    return { kind: 'error' };
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
