// The "Overview" tab body: AI summary block, 4-up indicator grid,
// and 2 panels (Notable findings + Recommended next steps).
// Consumes only fields already present on LookupResponse.

'use client';

import type { LookupResponse, ScoreFactor } from '@/lib/api/backend';

import { AnimatedNum } from './AnimatedNum';
import { RevealText } from './RevealText';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;

const DATASET_LINKS: Record<string, string> = {
  hpd: 'https://hpdonline.nyc.gov/hpdonline/',
  dob: 'https://a810-bisweb.nyc.gov/bisweb/bsqpm01.jsp',
  evictions: 'https://data.cityofnewyork.us/City-Government/Evictions/6z8x-wfk4',
  watchlist: 'https://landlordwatchlist.com/',
};

function findIndicatorUrl(
  indicators: SuccessData['indicators'],
  matchKey: string,
): string | undefined {
  const lower = matchKey.toLowerCase();
  for (const ind of indicators) {
    if (ind.key.toLowerCase().includes(lower)) return ind.source_url;
  }
  return undefined;
}

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

export function OverviewTab({ data }: { data: SuccessData }) {
  const {
    listing_summary,
    summary,
    score_factors,
    indicators,
    questions_to_ask,
    landlord,
    stats,
  } = data;

  const factorsForFindings: ScoreFactor[] = (score_factors ?? []).slice(0, 5);

  const watchlistRank = landlord?.watchlist_rank as number | null | undefined;
  const indicatorCards: Array<{
    k: string;
    v: string;
    src: string;
    url: string;
  }> = [
    {
      k: 'HPD violations · open',
      v: String(stats.hpd_violations_open ?? 0),
      src: 'HPD dataset',
      url: findIndicatorUrl(indicators, 'hpd') ?? DATASET_LINKS.hpd,
    },
    {
      k: 'DOB complaints (12 mo)',
      v: String(stats.dob_complaints ?? 0),
      src: 'DOB dataset',
      url: findIndicatorUrl(indicators, 'dob') ?? DATASET_LINKS.dob,
    },
    {
      k: 'Marshal evictions',
      v: String(stats.evictions ?? 0),
      src: 'DOI dataset',
      url:
        findIndicatorUrl(indicators, 'eviction') ?? DATASET_LINKS.evictions,
    },
    {
      k: 'Watchlist rank',
      v: typeof watchlistRank === 'number' ? `#${watchlistRank}` : '—',
      src: 'Public Adv.',
      url: findIndicatorUrl(indicators, 'watchlist') ?? DATASET_LINKS.watchlist,
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
          <div key={i.k} className="ind">
            <div className="k">{i.k}</div>
            <div className="v">
              <AnimatedNum value={i.v} />
            </div>
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
