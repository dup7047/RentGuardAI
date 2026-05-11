'use client';

import Link from 'next/link';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
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
            Try reloading this view. If it keeps happening, run a fresh lookup
            or contact support with the page you were trying to open.
          </p>
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
