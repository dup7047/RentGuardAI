// Sticky top nav — appears on every page via root layout.
//
// The nav shell (logo + links) renders immediately in the HTML stream.
// The auth CTA (signed-in vs anon buttons) is wrapped in Suspense so a
// slow Supabase session check never delays the rest of the page.

import { Suspense } from 'react';
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

// Async server component — isolated so its Supabase await doesn't block
// the surrounding nav shell from streaming.
async function NavAuthCta() {
  let userEmail: string | null = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    userEmail = data.user?.email ?? null;
  } catch {
    userEmail = null;
  }

  if (userEmail) {
    return (
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
    );
  }

  return (
    <>
      <Link href="/login" className="btn link sm">
        Sign in
      </Link>
      <Link href="/" className="btn primary sm">
        Get started
      </Link>
    </>
  );
}

// Shown while the auth check is in flight — matches the anon CTA dimensions
// so the nav doesn't shift when the real buttons appear.
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

export function NavBar() {
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
          <Link href="/how-it-works">How it works</Link>
          <Link href="/coverage">Coverage</Link>
          <Link href="/for-landlords">For landlords</Link>
          <Link href="/pricing">Pricing</Link>
        </div>

        <div className="nav-cta">
          <Suspense fallback={<NavCtaSkeleton />}>
            <NavAuthCta />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
