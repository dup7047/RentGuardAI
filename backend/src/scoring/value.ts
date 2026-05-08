// Apartment Value Score — deterministic, computed in code (NOT by the AI).
//
// Follows the same pattern as score.ts (building maintenance score):
//   - Auditable formula, reproducible, no AI involvement in picking the number
//   - AI's job is to narrate this score in value_explanation, not to pick it
//
// Score range: 0-100. Higher = better value for money.
//
// ┌──────────────┬─────────────────────────────────────────────┐
// │ band         │ meaning                                     │
// ├──────────────┼─────────────────────────────────────────────┤
// │ great_deal   │ 80-100  significantly below market         │
// │ fair         │ 60-79   at or near market rate             │
// │ above_market │ 40-59   modestly above market              │
// │ overpriced   │  0-39   significantly above market         │
// └──────────────┴─────────────────────────────────────────────┘
//
// Confidence levels drive UI visibility:
//   high   — scraped comps ≥20 + sqft present → show gauge
//   medium — blended or scraped ≥5 → show gauge with label
//   low    — baseline only → HIDE gauge, show "not enough comps" notice
//
// Returns null score when no listing rent/beds data is available.

import type { CompResult } from '../data/comps.js';

export type ValueBand = 'great_deal' | 'fair' | 'above_market' | 'overpriced';

export type ValueScoreFactor = {
  key: string;
  label: string;
  impact: number;   // signed integer (positive = good value)
  reason: string;
};

export type ValueConfidence = 'high' | 'medium' | 'low';

export type ValueScoreResult = {
  score: number;
  band: ValueBand;
  confidence: ValueConfidence;
  factors: ValueScoreFactor[];
  comp: CompResult;
};

export type ValueScoreInput = {
  monthlyRentCents: number;
  bedrooms: number;
  squareFeet: number | null;
  comp: CompResult;
};

/**
 * Map a rent-to-median ratio to a 0-100 score.
 * ratio < 1.0 = below market (better deal) → higher score
 * ratio = 1.0 = at market → score ~70 (fair)
 * ratio > 1.0 = above market → lower score
 *
 * We use a piecewise linear mapping so the scale feels intuitive:
 *   ≤ 0.70  → 100 (35%+ below median = great deal)
 *   0.70-0.90 → 80-99
 *   0.90-1.10 → 60-79 (fair zone ±10%)
 *   1.10-1.30 → 40-59
 *   ≥ 1.30  → 0 (30%+ above median = overpriced)
 */
function ratioToScore(ratio: number): number {
  if (ratio <= 0.70) return 100;
  if (ratio <= 0.90) return Math.round(80 + ((0.90 - ratio) / 0.20) * 19);
  if (ratio <= 1.10) return Math.round(60 + ((1.10 - ratio) / 0.20) * 19);
  if (ratio <= 1.30) return Math.round(40 + ((1.30 - ratio) / 0.20) * 19);
  return Math.max(0, Math.round(40 - ((ratio - 1.30) / 0.20) * 40));
}

function valueBand(score: number): ValueBand {
  if (score >= 80) return 'great_deal';
  if (score >= 60) return 'fair';
  if (score >= 40) return 'above_market';
  return 'overpriced';
}

function confidenceFromComp(comp: CompResult, hasSquareFeet: boolean): ValueConfidence {
  if (comp.source === 'scraped' && comp.sampleSize >= 20 && hasSquareFeet) return 'high';
  if (comp.source === 'scraped' || comp.source === 'blended') return 'medium';
  return 'low';
}

/**
 * Format a rent in cents as a human-readable string like "$3,200/mo".
 */
function fmtRent(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}/mo`;
}

export function computeValueScore(input: ValueScoreInput): ValueScoreResult {
  const { monthlyRentCents, squareFeet, comp } = input;
  const factors: ValueScoreFactor[] = [];

  const hasSquareFeet = squareFeet !== null && squareFeet > 0;
  const confidence = confidenceFromComp(comp, hasSquareFeet);

  // ── Primary signal: rent vs. borough median for this bedroom count ──────────
  const rentRatio = monthlyRentCents / comp.medianRentCents;
  const rentScore = ratioToScore(rentRatio);
  const pctDiff = Math.round((rentRatio - 1) * 100);
  const absPct = Math.abs(pctDiff);
  const rentReason =
    pctDiff <= -5
      ? `Listed ${fmtRent(monthlyRentCents)} — ${absPct}% below the ${comp.borough} median of ${fmtRent(comp.medianRentCents)} for ${comp.bedrooms === 0 ? 'studios' : `${comp.bedrooms}BR`} (${sourceLabel(comp)})`
      : pctDiff >= 5
        ? `Listed ${fmtRent(monthlyRentCents)} — ${absPct}% above the ${comp.borough} median of ${fmtRent(comp.medianRentCents)} for ${comp.bedrooms === 0 ? 'studios' : `${comp.bedrooms}BR`} (${sourceLabel(comp)})`
        : `Listed ${fmtRent(monthlyRentCents)} — at the ${comp.borough} median of ${fmtRent(comp.medianRentCents)} for ${comp.bedrooms === 0 ? 'studios' : `${comp.bedrooms}BR`} (${sourceLabel(comp)})`;

  // Impact is relative to "fair" baseline of 70 — positive means better than fair
  const rentImpact = rentScore - 70;
  factors.push({
    key: 'rent_vs_median',
    label: 'Rent vs. neighborhood median',
    impact: rentImpact,
    reason: rentReason,
  });

  // ── Secondary signal: $/sqft when available ─────────────────────────────────
  let sqftScore = 0;
  if (hasSquareFeet && comp.medianRentPerSqftCents != null) {
    const pricePerSqft = monthlyRentCents / squareFeet!;
    const sqftRatio = pricePerSqft / comp.medianRentPerSqftCents;
    sqftScore = ratioToScore(sqftRatio);
    const sqftPct = Math.round((sqftRatio - 1) * 100);
    const sqftAbsPct = Math.abs(sqftPct);
    const medianPerSqft = fmtPerSqft(comp.medianRentPerSqftCents);
    const listingPerSqft = fmtPerSqft(pricePerSqft * 100);
    const sqftReason =
      sqftPct <= -5
        ? `${listingPerSqft}/sqft — ${sqftAbsPct}% below the local median of ${medianPerSqft}/sqft`
        : sqftPct >= 5
          ? `${listingPerSqft}/sqft — ${sqftAbsPct}% above the local median of ${medianPerSqft}/sqft`
          : `${listingPerSqft}/sqft — at the local median of ${medianPerSqft}/sqft`;
    const sqftImpact = sqftScore - 70;
    factors.push({
      key: 'rent_per_sqft',
      label: '$/sqft vs. local median',
      impact: sqftImpact,
      reason: sqftReason,
    });
  }

  // ── Composite score ─────────────────────────────────────────────────────────
  // When sqft data is present: 60% rent-vs-median + 40% $/sqft.
  // When sqft is absent: 100% rent-vs-median.
  const composite =
    hasSquareFeet && comp.medianRentPerSqftCents != null
      ? Math.round(rentScore * 0.60 + sqftScore * 0.40)
      : rentScore;

  const finalScore = Math.max(0, Math.min(100, composite));
  const band = valueBand(finalScore);

  // Sort factors: most impactful first (by absolute impact)
  factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return { score: finalScore, band, confidence, factors, comp };
}

function sourceLabel(comp: CompResult): string {
  if (comp.source === 'scraped') return `n=${comp.sampleSize} recent listings`;
  if (comp.source === 'blended') return `n=${comp.sampleSize} recent + HUD/Census baseline`;
  return 'HUD/Census baseline';
}

function fmtPerSqft(centsPerSqft: number): string {
  return `$${(centsPerSqft / 100).toFixed(2)}`;
}

export function valueBandLabel(band: ValueBand): string {
  switch (band) {
    case 'great_deal': return 'Great deal';
    case 'fair': return 'Fair market rate';
    case 'above_market': return 'Above market';
    case 'overpriced': return 'Overpriced';
  }
}
