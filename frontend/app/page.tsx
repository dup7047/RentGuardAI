import { Suspense } from 'react';
import { LookupForm } from './lookup/LookupForm';

export const metadata = {
  title: 'RentGuard NYC — Look up any building before you sign',
  description:
    'Enter an NYC address or listing URL to get an AI-powered risk summary from HPD violations, DOB complaints, and landlord records.',
};

const SOURCES = [
  { ico: 'H', nm: 'HPD violations', ds: 'Open & closed code violations' },
  { ico: 'D', nm: 'DOB complaints', ds: 'Construction & safety filings' },
  { ico: 'E', nm: 'Evictions', ds: 'Marshal eviction records' },
  { ico: 'O', nm: 'Owner records', ds: 'HPD registered owner & officer' },
  { ico: 'W', nm: 'Watchlist', ds: 'Public Advocate Worst Landlord' },
] as const;

export default function HomePage() {
  return (
    <div className="landing screen-fade">
      <div className="landing-bg" />
      <div className="container">
        <div className="hero-center">
          <div className="eyebrow">
            <span className="ico" aria-hidden="true">
              ✦
            </span>
            Powered by NYC Open Data + AI
          </div>
          <h1 className="hero">
            Look up any NYC building <em>before you sign.</em>
          </h1>
          <p className="hero-sub">
            RentGuard pulls HPD violations, DOB complaints, owner records, and
            the Worst Landlord Watchlist into one plain-English risk report.
            Free for renters — 3 building lookups per month.
          </p>

          {/* Interactive search — client JS, shows skeleton until hydrated */}
          <Suspense fallback={<SearchCardSkeleton />}>
            <LookupForm />
          </Suspense>

          <div className="trust">
            <div className="item">
              <b>9</b>
              <span>NYC Open Data sources</span>
            </div>
            <div className="sep" />
            <div className="item">
              <b>$0</b>
              <span>Per lookup</span>
            </div>
          </div>

          <div className="sources-strip">
            <div className="label">What we check on every lookup</div>
            <div className="sources-grid">
              {SOURCES.map((s) => (
                <div key={s.ico} className="source-card">
                  <div className="ico">{s.ico}</div>
                  <div className="nm">{s.nm}</div>
                  <div className="ds">{s.ds}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SearchCardSkeleton() {
  return (
    <div className="search-card-wrap">
      <div className="search-card" style={{ minHeight: 68 }}>
        <div
          className="skel"
          style={{ flex: 1, height: 20, margin: '14px', borderRadius: 6 }}
        />
        <div
          className="skel"
          style={{ width: 110, height: 48, borderRadius: 8, flexShrink: 0 }}
        />
      </div>
    </div>
  );
}
