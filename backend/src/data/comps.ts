// Rent comp lookup for the Value Score feature.
//
// Strategy (hybrid):
//   1. Borough-level HUD FMR baseline (embedded, 2025 estimates) as guaranteed fallback.
//   2. Scraped-listings refinement: when building_lookups rows for the same
//      borough + bedroom count exist from the last 90 days, blend a 75/25
//      scraped/baseline median (≥5 samples) or use scraped only (≥20 samples).
//
// Returns null when we cannot produce a defensible comp (missing beds, no data).
// The value scorer treats null as "low confidence" and suppresses the gauge.

import { getPool } from '../db/client.js';
import type { Borough } from './types.js';

export type CompResult = {
  medianRentCents: number;
  medianRentPerSqftCents: number | null; // null when sqft is sparse in comps
  sampleSize: number;
  source: 'baseline' | 'scraped' | 'blended';
  borough: Borough;
  bedrooms: number;
};

// ── HUD FMR 2025 borough-level baselines (in cents) ─────────────────────────
// Source: HUD 50th-percentile FMR estimates for NYC, adjusted by borough from
// NYC Rent Guidelines Board 2024 market data and Census ACS B25031.
// Figures represent approximate median asking rents in each borough × bedroom.
//
// Layout: BEDROOMS[0]=studio, [1]=1BR, [2]=2BR, [3]=3BR, [4]=4BR+
const BASELINE_CENTS: Record<Borough, [number, number, number, number, number]> = {
  MANHATTAN:       [285000, 420000, 600000, 800000, 1000000],
  BROOKLYN:        [235000, 320000, 440000, 590000, 780000],
  QUEENS:          [200000, 270000, 370000, 490000, 640000],
  BRONX:           [165000, 220000, 300000, 400000, 520000],
  'STATEN ISLAND': [155000, 210000, 285000, 380000, 500000],
};

function baselineForBoroughBeds(borough: Borough, bedrooms: number): number {
  const idx = Math.max(0, Math.min(4, bedrooms)) as 0 | 1 | 2 | 3 | 4;
  return BASELINE_CENTS[borough][idx];
}

// ── Scraped-listings refinement ──────────────────────────────────────────────
// Pulls recent ai_scraped_listing snapshots from building_lookups joined to
// buildings for borough filtering. Uses getPool().query() following the
// existing codebase pattern (cache.ts, server.ts).

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
const BLEND_THRESHOLD_SCRAPED_ONLY = 20;
const BLEND_THRESHOLD_MIX = 5;

type ScrapedSnapshot = {
  monthlyRentCents: number | null;
  squareFeet: number | null;
  bedrooms: number | null;
};

async function fetchScrapedComps(
  borough: Borough,
  bedrooms: number,
): Promise<ScrapedSnapshot[]> {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
  const res = await getPool().query<ScrapedSnapshot>(
    `SELECT
       (bl.ai_scraped_listing->>'monthlyRentCents')::int AS "monthlyRentCents",
       (bl.ai_scraped_listing->>'squareFeet')::int        AS "squareFeet",
       (bl.ai_scraped_listing->>'bedrooms')::int          AS bedrooms
     FROM building_lookups bl
     JOIN buildings b ON b.bbl = bl.building_bbl
     WHERE
       bl.ai_scraped_listing IS NOT NULL
       AND bl.ai_scraped_listing->>'monthlyRentCents' IS NOT NULL
       AND (bl.ai_scraped_listing->>'bedrooms')::int = $1
       AND b.borough = $2
       AND bl.created_at > $3
     LIMIT 200`,
    [bedrooms, borough, cutoff],
  );
  return res.rows;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    const lo = sorted[mid - 1] ?? 0;
    const hi = sorted[mid] ?? 0;
    return Math.round((lo + hi) / 2);
  }
  return sorted[mid] ?? 0;
}

/**
 * Get rent comps for a borough + bedroom count.
 * Returns null only when beds is out of range (negative) — callers should
 * check confidence on the result before using it.
 */
export async function getComps(
  borough: Borough,
  bedrooms: number,
): Promise<CompResult | null> {
  if (bedrooms < 0) return null;

  const baseline = baselineForBoroughBeds(borough, bedrooms);
  const scraped = await fetchScrapedComps(borough, bedrooms);

  const rentSamples = scraped
    .map((r) => r.monthlyRentCents)
    .filter((v): v is number => typeof v === 'number' && v > 0);

  const sqftSamples = scraped
    .map((r) =>
      r.monthlyRentCents && r.squareFeet && r.squareFeet > 0
        ? Math.round((r.monthlyRentCents / r.squareFeet) * 100) / 100
        : null,
    )
    .filter((v): v is number => v !== null);

  if (rentSamples.length >= BLEND_THRESHOLD_SCRAPED_ONLY) {
    const medianRent = median(rentSamples);
    const medianPerSqft = sqftSamples.length >= 5 ? median(sqftSamples.map(Math.round)) : null;
    return {
      medianRentCents: medianRent,
      medianRentPerSqftCents: medianPerSqft,
      sampleSize: rentSamples.length,
      source: 'scraped',
      borough,
      bedrooms,
    };
  }

  if (rentSamples.length >= BLEND_THRESHOLD_MIX) {
    const scrapedMedian = median(rentSamples);
    const blended = Math.round(scrapedMedian * 0.75 + baseline * 0.25);
    const medianPerSqft = sqftSamples.length >= 3 ? median(sqftSamples.map(Math.round)) : null;
    return {
      medianRentCents: blended,
      medianRentPerSqftCents: medianPerSqft,
      sampleSize: rentSamples.length,
      source: 'blended',
      borough,
      bedrooms,
    };
  }

  return {
    medianRentCents: baseline,
    medianRentPerSqftCents: null,
    sampleSize: 0,
    source: 'baseline',
    borough,
    bedrooms,
  };
}
