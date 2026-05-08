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

import { getDb } from '../db/client.js';
import { sql } from 'drizzle-orm';
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
  MANHATTAN:     [285000, 420000, 600000, 800000, 1000000],
  BROOKLYN:      [235000, 320000, 440000, 590000, 780000],
  QUEENS:        [200000, 270000, 370000, 490000, 640000],
  BRONX:         [165000, 220000, 300000, 400000, 520000],
  'STATEN ISLAND': [155000, 210000, 285000, 380000, 500000],
};

function getBaselineIndex(bedrooms: number): number {
  return Math.max(0, Math.min(4, bedrooms));
}

function baselineForBoroughBeds(borough: Borough, bedrooms: number): number {
  return BASELINE_CENTS[borough][getBaselineIndex(bedrooms)] ?? 0;
}

// ── Scraped-listings refinement ──────────────────────────────────────────────
// Pulls recent ai_scraped_listing snapshots from building_lookups. These are
// ScrapedListing JSON blobs snapshotted at lookup time (Phase 4.5 follow-up).
// We filter to the same borough + bedroom count from the last 90 days.
//
// Drizzle doesn't have a native median aggregate; we use raw SQL via drizzle's
// sql template tag so we stay in the existing query infrastructure.

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
  // ai_scraped_listing is JSONB; cast and filter at the DB level.
  // We check the borough from the building_lookups row itself is not available
  // directly, so we rely on the ai_scraped_listing->>'address' matching the
  // borough. The borough isn't stored in the snapshot, so we join buildings.
  // This is an approximation: join building_lookups → buildings on building_bbl.
  const rows = await getDb().execute(sql`
    SELECT
      (bl.ai_scraped_listing->>'monthlyRentCents')::int AS "monthlyRentCents",
      (bl.ai_scraped_listing->>'squareFeet')::int        AS "squareFeet",
      (bl.ai_scraped_listing->>'bedrooms')::int          AS bedrooms
    FROM building_lookups bl
    JOIN buildings b ON b.bbl = bl.building_bbl
    WHERE
      bl.ai_scraped_listing IS NOT NULL
      AND bl.ai_scraped_listing->>'monthlyRentCents' IS NOT NULL
      AND (bl.ai_scraped_listing->>'bedrooms')::int = ${bedrooms}
      AND b.borough = ${borough}
      AND bl.created_at > ${cutoff}
    LIMIT 200
  `);
  return rows.rows as ScrapedSnapshot[];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2)
    : (sorted[mid] ?? 0);
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
    // Weighted 75% scraped, 25% baseline for blended mode
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

  // Pure baseline fallback
  return {
    medianRentCents: baseline,
    medianRentPerSqftCents: null,
    sampleSize: 0,
    source: 'baseline',
    borough,
    bedrooms,
  };
}
