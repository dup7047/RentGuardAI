'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

export default function BuildingError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const params = useParams<{ bbl?: string | string[] }>();
  const rawBbl = params?.bbl;
  const bbl = Array.isArray(rawBbl) ? rawBbl[0] : rawBbl;

  return (
    <div className="container screen-fade">
      <div className="center-card">
        <div className="card">
          <div className="center-card-icn" aria-hidden="true">
            !
          </div>
          <p className="auth-panel-kicker">Report unavailable</p>
          <h1>We could not load this building report.</h1>
          <p>
            The report service returned a temporary error while loading this
            building. Try again, or start a new lookup.
          </p>
          {bbl && (
            <p className="mono muted" style={{ fontSize: 12, marginTop: -8 }}>
              BBL {bbl}
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
