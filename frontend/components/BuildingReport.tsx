// Renders the full building risk report from the API success response.
// Used by both /building/[bbl] (ISR cached) and the post-lookup redirect.

import { LegalFraming } from './LegalFraming';
import { LegalFooter } from './LegalFooter';
import { buildingJsonLd } from '@/lib/seo/structured-data';
import type { LookupResponse } from '@/lib/api/backend';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;

export function BuildingReport({ data }: { data: SuccessData }) {
  const { bbl, address, borough, summary, indicators, landlord, fare_check, stats } = data;

  const jsonLd = buildingJsonLd({ address, bbl, summary: summary ?? '', borough });

  return (
    <article className="building-report">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <header>
        <h1>{address}</h1>
        <p className="building-meta">
          {borough} · BBL {bbl}
        </p>
      </header>

      <LegalFraming />

      <section className="summary-section" aria-label="AI risk summary">
        <h2>Risk Summary</h2>
        <p>{summary}</p>
      </section>

      {indicators.length > 0 && (
        <section className="indicators-section" aria-label="Data indicators">
          <h2>Key Indicators</h2>
          <ul>
            {indicators.map((ind, i) => (
              <li key={i}>
                <strong>{ind.key}:</strong> {ind.value}{' '}
                <a href={ind.source_url} target="_blank" rel="noopener noreferrer">
                  [source]
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="stats-section" aria-label="Raw counts">
        <h2>Public Record Counts</h2>
        <ul>
          <li>HPD violations (open): {stats.hpd_violations_open}</li>
          <li>HPD violations (closed): {stats.hpd_violations_closed}</li>
          <li>DOB complaints: {stats.dob_complaints}</li>
          <li>Marshal evictions: {stats.evictions}</li>
          <li>Bedbug reports: {stats.bedbug_reports}</li>
          <li>Lead paint flags: {stats.lead_flags}</li>
        </ul>
      </section>

      {landlord?.registered_owner_name && (
        <section className="landlord-section" aria-label="Registered owner">
          <h2>Registered Owner</h2>
          <p>{landlord.registered_owner_name}</p>
          {landlord.watchlist_rank != null && (
            <p className="watchlist-flag">
              ⚠ NYC Public Advocate Worst Landlord Watchlist — rank #{landlord.watchlist_rank}
            </p>
          )}
          {landlord.head_officer_name && (
            <p>Head officer: {landlord.head_officer_name}</p>
          )}
        </section>
      )}

      {fare_check && fare_check.flag !== 'unclear' && (
        <section className="fare-section" aria-label="FARE Act check">
          <h2>FARE Act Check</h2>
          <p>
            <strong>
              {fare_check.flag === 'possible_violation'
                ? '⚠ Possible FARE Act violation detected'
                : '✓ No broker-fee language found'}
            </strong>
          </p>
          <p>{fare_check.explanation}</p>
        </section>
      )}

      <LegalFooter />
    </article>
  );
}
