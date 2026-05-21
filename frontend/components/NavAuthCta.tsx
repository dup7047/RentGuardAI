'use client';

// Client-side auth CTA — moved out of the server-rendered NavBar so that
// reading cookies for the Supabase session does not opt every public route
// out of static rendering. The skeleton mounts on first paint and is replaced
// post-hydration once supabase.auth.getUser() resolves.

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { signOut } from '@/app/dashboard/actions';
import { createClient } from '@/lib/supabase/browser';

type State =
  | { status: 'loading' }
  | { status: 'anon' }
  | { status: 'authed'; email: string };

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return 'R';
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return (local[0] ?? 'R').toUpperCase();
  if (parts.length === 1) return (parts[0][0] ?? 'R').toUpperCase();
  return ((parts[0][0] ?? '') + (parts[1][0] ?? '')).toUpperCase();
}

function NavCtaSkeleton() {
  return (
    <>
      <div
        className="skel"
        style={{ width: 56, height: 30, borderRadius: 6 }}
        aria-hidden="true"
      />
      <div
        className="skel"
        style={{ width: 88, height: 30, borderRadius: 6 }}
        aria-hidden="true"
      />
    </>
  );
}

export function NavAuthCta() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (cancelled) return;
        const email = data.user?.email ?? null;
        setState(email ? { status: 'authed', email } : { status: 'anon' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'anon' });
      });

    // Keep the chip in sync if the user signs in or out in another tab.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const email = session?.user?.email ?? null;
      setState(email ? { status: 'authed', email } : { status: 'anon' });
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (state.status === 'loading') return <NavCtaSkeleton />;

  if (state.status === 'authed') {
    return (
      <>
        <Link href="/dashboard" className="btn ghost sm">
          Dashboard
        </Link>
        <form action={signOut} style={{ display: 'inline-flex' }}>
          <button
            type="submit"
            className="nav-avatar"
            aria-label={`Sign out (${state.email})`}
            title={`Sign out (${state.email})`}
          >
            {initialsFromEmail(state.email)}
          </button>
        </form>
      </>
    );
  }

  return (
    <>
      <Link href="/login" className="btn link sm" prefetch={false}>
        Sign in
      </Link>
      <Link href="/" className="btn primary sm">
        Get started
      </Link>
    </>
  );
}
