'use client';

import { useEffect } from 'react';

import { useLockBodyScroll } from '@/lib/useLockBodyScroll';

type MetricKind = 'maintenance' | 'value';

export function MetricInfoModal({
  kind,
  onClose,
}: {
  kind: MetricKind;
  onClose: () => void;
}) {
  useLockBodyScroll();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="modal-veil"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="metric-modal-title"
        style={{ maxWidth: 480 }}
      >
        <button
          type="button"
          className="close-x"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>

        {kind === 'maintenance' ? (
          <>
            <h3 id="metric-modal-title">How the maintenance score is calculated</h3>
            <p style={{ color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.6 }}>
              The score starts at <strong>100</strong> and penalties are subtracted based on public NYC records.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <ScoreRow
                label="Open HPD violations"
                detail="Housing Preservation &amp; Development issues active violations. Class C (immediately hazardous) carry the heaviest penalty; Class B (hazardous) and Class A (non-hazardous) carry lighter ones."
                source="HPD Online"
              />
              <ScoreRow
                label="DOB complaints (12 months)"
                detail="Department of Buildings complaints filed in the past year. Unresolved or high-priority complaints add to the penalty."
                source="DOB BIS"
              />
              <ScoreRow
                label="Marshal evictions"
                detail="Court-ordered evictions executed by city marshals. Multiple evictions signal landlord-tenant disputes and possible housing instability."
                source="DOI dataset"
              />
              <ScoreRow
                label="Public Advocate watchlist"
                detail="The NYC Public Advocate publishes an annual list of the city's worst landlords by complaint volume. Appearing on — or near — this list adds a significant penalty."
                source="Public Advocate"
              />
            </div>

            <div
              style={{
                marginTop: 20,
                padding: '12px 14px',
                background: 'var(--surface-2)',
                borderRadius: 8,
                fontSize: 13,
                color: 'var(--ink-2)',
                lineHeight: 1.6,
              }}
            >
              <strong>Score bands:</strong>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <BandRow color="var(--good)" label="Minimal concern" desc="score ≥ 80" />
                <BandRow color="oklch(0.55 0.15 70)" label="Moderate concern" desc="score 60–79" />
                <BandRow color="oklch(0.52 0.18 50)" label="Elevated concern" desc="score 40–59" />
                <BandRow color="var(--bad)" label="High concern" desc="score &lt; 40" />
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 14, lineHeight: 1.5 }}>
              All data is sourced directly from NYC open data APIs and refreshed regularly. Scores are informational, not legal advice.
            </p>
          </>
        ) : (
          <>
            <h3 id="metric-modal-title">How the value score is calculated</h3>
            <p style={{ color: 'var(--ink-2)', fontSize: 14, lineHeight: 1.6 }}>
              The value score compares this unit&apos;s asking rent to recent comparable listings in the same area.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
              <ScoreRow
                label="Comparable listings"
                detail="We look at active and recently closed rentals in the same neighborhood with a similar bedroom count and square footage."
                source="StreetEasy / Zillow"
              />
              <ScoreRow
                label="Borough & bedroom median"
                detail="The unit's rent is benchmarked against the median for its borough and bedroom count, adjusted for recency."
                source="NYC Housing data"
              />
              <ScoreRow
                label="Price-per-sqft adjustment"
                detail="When square footage is available, we also compare price per square foot to remove size bias from the comparison."
                source="Listing data"
              />
              <ScoreRow
                label="Confidence level"
                detail="High confidence means 10+ recent comps were found. Medium confidence (flagged with 'limited data') means fewer comps are available and the estimate is less precise."
                source="Internal"
              />
            </div>

            <div
              style={{
                marginTop: 20,
                padding: '12px 14px',
                background: 'var(--surface-2)',
                borderRadius: 8,
                fontSize: 13,
                color: 'var(--ink-2)',
                lineHeight: 1.6,
              }}
            >
              <strong>Value bands:</strong>
              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <BandRow color="var(--good)" label="Great deal" desc="rent &gt;10% below median" />
                <BandRow color="var(--good)" label="Fair market rate" desc="within 10% of median" />
                <BandRow color="oklch(0.52 0.18 50)" label="Above market" desc="10–25% above median" />
                <BandRow color="var(--bad)" label="Overpriced" desc="&gt;25% above median" />
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 14, lineHeight: 1.5 }}>
              Value scores are not shown when fewer than 3 comparable listings are found. Rental markets move fast — always verify current comps independently.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ScoreRow({
  label,
  detail,
  source,
}: {
  label: string;
  detail: string;
  source: string;
}) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: 'var(--surface-2)',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 3 }}>{label}</div>
      <div style={{ color: 'var(--ink-2)' }} dangerouslySetInnerHTML={{ __html: detail }} />
      <div style={{ color: 'var(--muted)', marginTop: 4, fontSize: 12 }}>Source: {source}</div>
    </div>
  );
}

function BandRow({
  color,
  label,
  desc,
}: {
  color: string;
  label: string;
  desc: string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: color,
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 500 }}>{label}</span>
      <span
        style={{ color: 'var(--muted)', fontSize: 12 }}
        dangerouslySetInnerHTML={{ __html: `— ${desc}` }}
      />
    </div>
  );
}
