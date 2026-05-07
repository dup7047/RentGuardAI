// Building risk score — DETERMINISTIC, computed in code, NOT by the AI.
//
// Why deterministic:
//   - Defensible: it's a published formula, not editorial opinion
//   - Reproducible: same record counts → same score every time
//   - Auditable: score_factors[] returns exactly which counts moved the needle
//   - Cheap: no AI tokens needed
//
// The AI's job is to NARRATE this score (the score_explanation field), not to
// pick it. The prompt enforces that.
//
// Score range: 0-100. Higher = lower concern.
//
// ┌─────────┬───────────────┐
// │ band    │ score range   │
// ├─────────┼───────────────┤
// │ minimal │ 80 – 100      │
// │ moderate│ 60 – 79       │
// │ elevated│ 40 – 59       │
// │ high    │  0 – 39       │
// └─────────┴───────────────┘

import type { ScrapedListing } from '../scraping/types.js';

export type ScoreBand = 'minimal' | 'moderate' | 'elevated' | 'high';

export type ScoreFactor = {
  key: string;          // stable identifier (used by frontend for icons/tooltips)
  label: string;        // human-readable factor name
  impact: number;       // signed integer (negative = penalty, positive = bonus)
  reason: string;       // verbatim wording (e.g. "12 open HPD violations")
};

export type ScoreResult = {
  score: number;            // 0–100
  band: ScoreBand;
  factors: ScoreFactor[];   // ordered by absolute impact, descending
};

export type ScoreInput = {
  hpdViolationsOpen: number;
  hpdViolationsClosed: number;
  dobComplaints: number;
  evictions: number;
  bedbugReports: number;
  leadFlags: number;
  watchlistRank: number | null;     // 1 = worst landlord; null = not on list
  fareFlag: 'no_indicators' | 'possible_violation' | 'unclear' | null;
  scrapedListing: ScrapedListing | null;
};

// ── Penalty schedule ─────────────────────────────────────────────────────────
// Tunable in one place. Change here = score behavior change for everyone.
const HPD_VIOLATION_PENALTY = 1;       // per open violation
const HPD_VIOLATION_CAP = 25;          // can't subtract more than 25 for violations alone
const EVICTION_PENALTY = 3;            // per marshal eviction
const EVICTION_CAP = 15;
const BEDBUG_PENALTY = 1;              // per bedbug report
const BEDBUG_CAP = 8;
const LEAD_PENALTY = 2;                // per lead-paint flag
const LEAD_CAP = 10;
const DOB_PENALTY_X10 = 5;             // 0.5 per DOB complaint, in tenths to keep math integer
const DOB_CAP = 10;
const WATCHLIST_TOP_PENALTY = 30;      // ranks 1–10
const WATCHLIST_MID_PENALTY = 15;      // ranks 11–100
const WATCHLIST_OTHER_PENALTY = 10;    // anywhere on the list
const FARE_VIOLATION_PENALTY = 10;
const FARE_UNCLEAR_PENALTY = 3;
const CLEARED_VIOLATION_BONUS = 2;     // closed > 5x open

export function computeScore(input: ScoreInput): ScoreResult {
  let score = 100;
  const factors: ScoreFactor[] = [];

  // HPD open violations
  if (input.hpdViolationsOpen > 0) {
    const raw = input.hpdViolationsOpen * HPD_VIOLATION_PENALTY;
    const impact = -Math.min(raw, HPD_VIOLATION_CAP);
    score += impact;
    factors.push({
      key: 'hpd_violations_open',
      label: 'Open HPD violations',
      impact,
      reason: `${input.hpdViolationsOpen} open HPD violation${input.hpdViolationsOpen === 1 ? '' : 's'}`,
    });
  } else {
    factors.push({
      key: 'hpd_violations_open',
      label: 'Open HPD violations',
      impact: 0,
      reason: 'No open HPD violations',
    });
  }

  // Evictions
  if (input.evictions > 0) {
    const raw = input.evictions * EVICTION_PENALTY;
    const impact = -Math.min(raw, EVICTION_CAP);
    score += impact;
    factors.push({
      key: 'evictions',
      label: 'Marshal evictions',
      impact,
      reason: `${input.evictions} marshal eviction${input.evictions === 1 ? '' : 's'} on file`,
    });
  } else {
    factors.push({
      key: 'evictions',
      label: 'Marshal evictions',
      impact: 0,
      reason: 'No marshal evictions on file',
    });
  }

  // Bedbug reports
  if (input.bedbugReports > 0) {
    const raw = input.bedbugReports * BEDBUG_PENALTY;
    const impact = -Math.min(raw, BEDBUG_CAP);
    score += impact;
    factors.push({
      key: 'bedbug_reports',
      label: 'Bedbug reports',
      impact,
      reason: `${input.bedbugReports} bedbug report${input.bedbugReports === 1 ? '' : 's'}`,
    });
  }

  // Lead paint
  if (input.leadFlags > 0) {
    const raw = input.leadFlags * LEAD_PENALTY;
    const impact = -Math.min(raw, LEAD_CAP);
    score += impact;
    factors.push({
      key: 'lead_paint',
      label: 'Lead paint citations',
      impact,
      reason: `${input.leadFlags} lead paint inspection finding${input.leadFlags === 1 ? '' : 's'}`,
    });
  }

  // DOB complaints (half-point each, integer math)
  if (input.dobComplaints > 0) {
    const raw = Math.floor((input.dobComplaints * DOB_PENALTY_X10) / 10);
    const impact = -Math.min(raw, DOB_CAP);
    score += impact;
    factors.push({
      key: 'dob_complaints',
      label: 'DOB complaints',
      impact,
      reason: `${input.dobComplaints} DOB complaint${input.dobComplaints === 1 ? '' : 's'}`,
    });
  }

  // Worst Landlord Watchlist
  if (input.watchlistRank != null) {
    let impact: number;
    if (input.watchlistRank <= 10) impact = -WATCHLIST_TOP_PENALTY;
    else if (input.watchlistRank <= 100) impact = -WATCHLIST_MID_PENALTY;
    else impact = -WATCHLIST_OTHER_PENALTY;
    score += impact;
    factors.push({
      key: 'watchlist_rank',
      label: 'NYC Public Advocate Worst Landlord Watchlist',
      impact,
      reason: `Owner ranked #${input.watchlistRank} on the NYC Worst Landlord Watchlist`,
    });
  } else {
    factors.push({
      key: 'watchlist_rank',
      label: 'NYC Public Advocate Worst Landlord Watchlist',
      impact: 0,
      reason: 'Owner not on Worst Landlord Watchlist',
    });
  }

  // FARE Act check
  if (input.fareFlag === 'possible_violation') {
    const impact = -FARE_VIOLATION_PENALTY;
    score += impact;
    factors.push({
      key: 'fare_act',
      label: 'FARE Act',
      impact,
      reason: 'Listing language suggests possible FARE Act violation (broker fee charged to tenant)',
    });
  } else if (input.fareFlag === 'unclear') {
    const impact = -FARE_UNCLEAR_PENALTY;
    score += impact;
    factors.push({
      key: 'fare_act',
      label: 'FARE Act',
      impact,
      reason: 'Listing has mixed signals about broker fees — verify in writing',
    });
  } else if (input.fareFlag === 'no_indicators') {
    factors.push({
      key: 'fare_act',
      label: 'FARE Act',
      impact: 0,
      reason: 'No FARE Act flags found in listing copy',
    });
  }

  // Bonus: cleared-violations ratio (very strong indicator of responsive landlord)
  if (
    input.hpdViolationsClosed > 5 &&
    (input.hpdViolationsOpen === 0 || input.hpdViolationsClosed > input.hpdViolationsOpen * 5)
  ) {
    score += CLEARED_VIOLATION_BONUS;
    factors.push({
      key: 'cleared_ratio',
      label: 'Cleared violation ratio',
      impact: CLEARED_VIOLATION_BONUS,
      reason: `${input.hpdViolationsClosed} HPD violations have been resolved`,
    });
  }

  // Clamp + band
  score = Math.max(0, Math.min(100, score));
  const band: ScoreBand =
    score >= 80 ? 'minimal' : score >= 60 ? 'moderate' : score >= 40 ? 'elevated' : 'high';

  // Order factors by absolute impact (most-negative first)
  factors.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));

  return { score, band, factors };
}

/**
 * Human-readable band copy for use in UI / prompts.
 */
export function bandLabel(band: ScoreBand): string {
  switch (band) {
    case 'minimal':
      return 'Minimal concern';
    case 'moderate':
      return 'Moderate concern';
    case 'elevated':
      return 'Elevated concern';
    case 'high':
      return 'High concern';
  }
}
