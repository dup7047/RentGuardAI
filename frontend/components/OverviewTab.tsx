// The "Overview" tab body: AI summary block, 4-up indicator grid,
// and 2 panels (Notable findings + Recommended next steps).
// Consumes only fields already present on LookupResponse.

'use client';

import type { LookupResponse, ScoreFactor } from '@/lib/api/backend';
import { getValueBandLabel } from '@/lib/api/backend';
import {
  dobComplaintsUrl,
  evictionsUrl,
  hpdViolationsUrl,
  watchlistUrl,
} from '@/lib/sources/urls';

import { AnimatedNum } from './AnimatedNum';
import { RevealText } from './RevealText';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;
type NavTab = 'violations' | 'complaints' | 'owner';

function findingTone(impact: number): 'good' | 'warn' | 'bad' {
  if (impact < 0) return 'bad';
  if (impact === 0) return 'good';
  return 'warn';
}
function findingGlyph(tone: 'good' | 'warn' | 'bad'): string {
  return tone === 'good' ? '✓' : tone === 'warn' ? '!' : '✕';
}

const FALLBACK_NEXT_STEPS = [
  {
    t: 'Verify ownership in person',
    d: 'Cross-check the registered owner name on the lease.',
  },
  {
    t: 'Ask about open violations',
    d: 'Request the HPD violation list from the broker before signing.',
  },
  {
    t: 'Tour the unit',
    d: "Confirm conditions match what's listed; photograph everything.",
  },
  {
    t: 'Save this report',
    d: 'Pin it to your dashboard so we can re-check before you sign.',
  },
];

export function OverviewTab({
  data,
  onSelectTab,
}: {
  data: SuccessData;
  onSelectTab?: (tab: NavTab) => void;
}) {
  const {
    bbl,
    listing_summary,
    summary,
    score_factors,
    questions_to_ask,
    landlord,
    stats,
    listing_unavailable,
    value_explanation,
    value_band,
    value_confidence,
  } = data;

  const factorsForFindings: ScoreFactor[] = (score_factors ?? []).slice(0, 5);

  const watchlistRank = landlord?.watchlist_rank as number | null | undefined;
  const registeredOwnerName = landlord?.registered_owner_name as string | null | undefined;

  const indicatorCards: Array<{
    k: string;
    v: string;
    src: string;
    url: string;
    tabId: NavTab;
  }> = [
    {
      k: 'HPD violations · open',
      v: String(stats.hpd_violations_open ?? 0),
      src: 'HPD Online',
      url: hpdViolationsUrl({ hpdBuildingId: data.hpd_building_id, bbl }),
      tabId: 'violations',
    },
    {
      k: 'DOB complaints (12 mo)',
      v: String(stats.dob_complaints ?? 0),
      src: 'DOB BIS',
      url: dobComplaintsUrl({ bin: data.bin }),
      tabId: 'complaints',
    },
    {
      k: 'Marshal evictions',
      v: String(stats.evictions ?? 0),
      src: 'DOI dataset',
      url: evictionsUrl({ bbl }),
      tabId: 'complaints',
    },
    {
      k: 'Watchlist rank',
      v: typeof watchlistRank === 'number' ? `#${watchlistRank}` : '—',
      src: 'Public Adv.',
      url: watchlistUrl({ registeredOwnerName, watchlistRank }),
      tabId: 'owner',
    },
  ];

  const nextSteps =
    questions_to_ask && questions_to_ask.length > 0
      ? questions_to_ask.slice(0, 4).map((t, i) => ({ n: String(i + 1), t, d: '' }))
      : FALLBACK_NEXT_STEPS.map((s, i) => ({ n: String(i + 1), ...s }));

  const showFindings = factorsForFindings.length > 0;

  return (
    <>
      {/* Listing review (only when the user pasted a listing URL) */}
      {listing_summary && (
        <div className="ai-block">
          <div className="ai-tag">✦ LISTING REVIEW</div>
          <p>
            <RevealText text={listing_summary} />
          </p>
        </div>
      )}

      {/* Listing-data-unavailable notice — fires when the user pasted a URL
          but the scraper was blocked and we recovered the address by parsing
          the URL slug. Tells the user the review covers the building only
          and not listing-specific fields like rent, beds, or broker fee. */}
      {listing_unavailable && !listing_summary && (
        <div className="ai-block">
          <div className="ai-tag">✦ LISTING DATA UNAVAILABLE</div>
          <p>
            We couldn&apos;t read the listing page (the site blocked our scraper),
            so this review covers the building&apos;s public records only — not
            listing-specific details like rent, bedrooms, or broker fees.
          </p>
        </div>
      )}

      {/* Value analysis block — shown before the building summary when present */}
      {value_explanation && value_confidence !== 'low' && (
        <div className="ai-block">
          <div className="ai-tag">
            ✦ VALUE ANALYSIS
            {value_band && (
              <span
                style={{
                  marginLeft: 8,
                  fontWeight: 600,
                  textTransform: 'none',
                  letterSpacing: 0,
                }}
              >
                · {getValueBandLabel(value_band)}
              </span>
            )}
          </div>
          <p>
            <RevealText text={value_explanation} />
          </p>
        </div>
      )}

      {/* AI summary block */}
      {summary && (
        <div className="ai-block">
          <div className="ai-tag">✦ AI BUILDING SUMMARY</div>
          <p>
            <RevealText text={summary} />
          </p>
        </div>
      )}

      {/* 4-up indicator grid */}
      <div className="ind-grid">
        {indicatorCards.map((i) => (
          <div
            key={i.k}
            className="ind"
          >
            {onSelectTab ? (
              <button
                type="button"
                className="ind-nav"
                onClick={() => onSelectTab(i.tabId)}
              >
                <span className="k">{i.k}</span>
                <span className="v">
                  <AnimatedNum value={i.v} />
                </span>
              </button>
            ) : (
              <div className="ind-static">
                <div className="k">{i.k}</div>
                <div className="v">
                  <AnimatedNum value={i.v} />
                </div>
              </div>
            )}
            <div className="src">
              <a
                href={i.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                ↗ {i.src}
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* 2-column panels */}
      <div className={`panels ${showFindings ? '' : 'single'}`}>
        {showFindings && (
          <div className="card panel">
            <h3>Notable findings</h3>
            {factorsForFindings.map((f) => {
              const tone = findingTone(f.impact);
              return (
                <div key={f.key} className="finding">
                  <div className={`icn ${tone}`} aria-hidden="true">
                    {findingGlyph(tone)}
                  </div>
                  <div className="body">
                    <b>{f.label}</b>
                    <span>{f.reason}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="card panel">
          <h3>Recommended next steps</h3>
          {nextSteps.map((s) => (
            <div key={s.n} className="finding">
              <div className="icn num" aria-hidden="true">
                {s.n}
              </div>
              <div className="body">
                <b>{s.t}</b>
                {s.d ? <span>{s.d}</span> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
