import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="container screen-fade">
      <div className="center-card">
        <div className="card">
          <div className="center-card-icn" aria-hidden="true">
            ?
          </div>
          <p className="auth-panel-kicker">Page not found</p>
          <h1>That page is not on RentGuard.</h1>
          <p>
            The link may be stale, or the building report may not exist yet.
            Start a new lookup and we will check the live public records.
          </p>
          <div className="center-card-actions">
            <Link href="/" className="btn primary">
              Run a lookup
            </Link>
            <Link href="/coverage" className="btn ghost">
              See coverage
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
