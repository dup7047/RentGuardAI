'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function LookupError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[lookup error boundary]', error);
  }, [error]);

  return (
    <div className="container screen-fade">
      <div className="center-card">
        <div className="card">
          <div className="center-card-icn" aria-hidden="true">
            !
          </div>
          <p className="auth-panel-kicker">Lookup error</p>
          <h1>We hit a snag running this lookup.</h1>
          <p>
            Try the lookup again. If it keeps failing, email{' '}
            <a href="mailto:hello@rentguard.cc">hello@rentguard.cc</a> and we
            will take a look.
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
