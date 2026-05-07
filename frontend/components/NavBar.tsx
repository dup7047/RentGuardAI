// Sticky top nav — appears on every page via root layout.
// Server component that reads the Supabase session and conditionally renders
// signed-in vs anon CTAs. Sign-out is handled by the existing dashboard
// server action so we don't need a client island here.

import Image from 'next/image';
import Link from 'next/link';

import { signOut } from '@/app/dashboard/actions';
import { createClient } from '@/lib/supabase/server';

function initialsFromEmail(email: string | null | undefined): string {
  if (!email) return 'R';
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);
  if (parts.length === 0) return (local[0] ?? 'R').toUpperCase();
  if (parts.length === 1) return (parts[0][0] ?? 'R').toUpperCase();
  return ((parts[0][0] ?? '') + (parts[1][0] ?? '')).toUpperCase();
}

export async function NavBar() {
  // The supabase client may fail to construct if env vars are missing
  // (e.g. local dev without .env.local). Treat any failure as "anon".
  let userEmail: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userEmail = data.user?.email ?? null;
  } catch {
    userEmail = null;
  }

  const signedIn = !!userEmail;

  return (
    <div className="nav">
      <div className="nav-inner">
        <Link href="/" className="brand" aria-label="RentGuard home">
          <Image
            src="/logo-lockup.png"
            alt="RentGuard"
            width={200}
            height={82}
            priority
            style={{ display: 'block', width: 'auto', height: '36px' }}
          />
        </Link>

        <div className="nav-links">
          <a href="#how">How it works</a>
          <a href="#coverage">Coverage</a>
          <a href="#landlords">For landlords</a>
          <a href="#pricing">Pricing</a>
        </div>

        <div className="nav-cta">
          {signedIn ? (
            <>
              <Link href="/dashboard" className="btn ghost sm">
                Dashboard
              </Link>
              <form action={signOut} style={{ display: 'inline-flex' }}>
                <button
                  type="submit"
                  className="nav-avatar"
                  aria-label={`Sign out (${userEmail})`}
                  title={`Sign out (${userEmail})`}
                >
                  {initialsFromEmail(userEmail)}
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/login" className="btn link sm">
                Sign in
              </Link>
              <Link href="/" className="btn primary sm">
                Get started
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
