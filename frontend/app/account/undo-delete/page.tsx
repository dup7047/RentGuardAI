import type { Metadata } from 'next';
import Link from 'next/link';

import { undoDeleteAction } from '@/app/dashboard/actions';

export const metadata: Metadata = {
  title: 'Undo account deletion — RentGuard NYC',
  robots: { index: false, follow: false },
};

// The undo link arrives in the deletion-confirmation email. We treat the
// token in the query string as the authorization (the user may be on a
// different device than the one they were signed in on, so we cannot rely
// on a Supabase session being present here). The backend validates the
// signed JWT and clears profiles.deletion_requested_at.

type SearchParams = { token?: string | string[] };

function pickToken(token: string | string[] | undefined): string | null {
  if (!token) return null;
  const v = Array.isArray(token) ? token[0] : token;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export default async function UndoDeletePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { token: rawToken } = await searchParams;
  const token = pickToken(rawToken);
  const result = token ? await undoDeleteAction(token) : { ok: false as const, reason: 'invalid_token' as const };

  return (
    <div className="container screen-fade">
      <div className="center-card">
        <div className="card">
          {result.ok ? (
            <>
              <div className="center-card-icn" aria-hidden="true">
                ✓
              </div>
              <p className="auth-panel-kicker">Account restored</p>
              <h1>Your account is back.</h1>
              <p>
                We cleared the deletion request. Nothing else changed — your
                saved buildings and profile are exactly as they were.
              </p>
              <div className="center-card-actions">
                <Link href="/dashboard" className="btn primary">
                  Go to dashboard
                </Link>
                <Link href="/" className="btn ghost">
                  New lookup
                </Link>
              </div>
            </>
          ) : (
            <>
              <div className="center-card-icn" aria-hidden="true">
                !
              </div>
              <p className="auth-panel-kicker">Link unavailable</p>
              <h1>This undo link did not work.</h1>
              <p>
                {result.reason === 'invalid_token'
                  ? 'The link is expired or was already used. Undo links expire after 30 days.'
                  : 'We could not reach the account service. Please try again, or email hello@rentguard.cc if it keeps failing.'}
              </p>
              <div className="center-card-actions">
                <Link href="/login" className="btn primary">
                  Sign in
                </Link>
                <a href="mailto:hello@rentguard.cc" className="btn ghost">
                  Contact support
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
