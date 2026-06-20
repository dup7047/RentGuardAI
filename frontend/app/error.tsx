'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[root error boundary]', error);
  }, [error]);

  return (
    <div className="container screen-fade">
      <div className="center-card">
        <div className="card">
          <div className="center-card-icn" aria-hidden="true">
            !
          </div>
          <p className="auth-panel-kicker">Something went wrong</p>
          <h1>RentGuard hit a loading issue.</h1>
          <p>
            Try again. If it keeps happening, this is on us. Drop us a line at{' '}
            <a href="mailto:hello@rentguard.cc">hello@rentguard.cc</a> and we
            will dig in.
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
