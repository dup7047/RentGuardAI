'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[dashboard error boundary]', error);
  }, [error]);

  return (
    <div className="container screen-fade">
      <div className="center-card">
        <div className="card">
          <div className="center-card-icn" aria-hidden="true">
            !
          </div>
          <p className="auth-panel-kicker">Dashboard unavailable</p>
          <h1>We could not load your dashboard.</h1>
          <p>
            Try reloading. If your saved buildings stay hidden, email{' '}
            <a href="mailto:hello@rentguard.cc">hello@rentguard.cc</a> and we
            will check the account.
          </p>
          {error.digest && (
            <p className="mono muted" style={{ fontSize: 12, marginTop: -8 }}>
              Error reference: {error.digest}
            </p>
          )}
          <div className="center-card-actions">
            <button type="button" className="btn primary" onClick={reset}>
              Try again
            </button>
            <Link href="/" className="btn ghost">
              New lookup
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
