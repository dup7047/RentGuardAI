import { describe, it, expect } from 'vitest';
import { computeScore, bandLabel } from '../../src/scoring/score.js';

const CLEAN_INPUT = {
  hpdViolationsOpen: 0,
  hpdViolationsClosed: 0,
  dobComplaints: 0,
  evictions: 0,
  bedbugReports: 0,
  leadFlags: 0,
  watchlistRank: null,
  fareFlag: null,
  scrapedListing: null,
};

describe('computeScore', () => {
  it('returns score=100 / band=minimal for a perfectly clean building', () => {
    const r = computeScore(CLEAN_INPUT);
    expect(r.score).toBe(100);
    expect(r.band).toBe('minimal');
  });

  it('penalizes open HPD violations 1 point each, capped at 25', () => {
    expect(computeScore({ ...CLEAN_INPUT, hpdViolationsOpen: 5 }).score).toBe(95);
    expect(computeScore({ ...CLEAN_INPUT, hpdViolationsOpen: 100 }).score).toBe(75); // capped at -25
  });

  it('penalizes evictions 3 points each, capped at 15', () => {
    expect(computeScore({ ...CLEAN_INPUT, evictions: 1 }).score).toBe(97);
    expect(computeScore({ ...CLEAN_INPUT, evictions: 100 }).score).toBe(85); // capped at -15
  });

  it('penalizes bedbug reports 1 point each, capped at 8', () => {
    expect(computeScore({ ...CLEAN_INPUT, bedbugReports: 5 }).score).toBe(95);
    expect(computeScore({ ...CLEAN_INPUT, bedbugReports: 100 }).score).toBe(92); // capped at -8
  });

  it('penalizes lead paint flags 2 points each, capped at 10', () => {
    expect(computeScore({ ...CLEAN_INPUT, leadFlags: 3 }).score).toBe(94);
    expect(computeScore({ ...CLEAN_INPUT, leadFlags: 100 }).score).toBe(90);
  });

  it('penalizes DOB complaints 0.5 points each (integer math), capped at 10', () => {
    expect(computeScore({ ...CLEAN_INPUT, dobComplaints: 4 }).score).toBe(98); // 4*0.5 = 2
    expect(computeScore({ ...CLEAN_INPUT, dobComplaints: 100 }).score).toBe(90);
  });

  it('penalizes watchlist landlords by tier', () => {
    expect(computeScore({ ...CLEAN_INPUT, watchlistRank: 1 }).score).toBe(70);  // top 10 → -30
    expect(computeScore({ ...CLEAN_INPUT, watchlistRank: 50 }).score).toBe(85); // 11-100 → -15
    expect(computeScore({ ...CLEAN_INPUT, watchlistRank: 500 }).score).toBe(90); // other → -10
  });

  it('penalizes FARE Act possible_violation by 10', () => {
    expect(computeScore({ ...CLEAN_INPUT, fareFlag: 'possible_violation' }).score).toBe(90);
    expect(computeScore({ ...CLEAN_INPUT, fareFlag: 'unclear' }).score).toBe(97);
    expect(computeScore({ ...CLEAN_INPUT, fareFlag: 'no_indicators' }).score).toBe(100);
  });

  it('rewards a high cleared/open ratio', () => {
    const r = computeScore({ ...CLEAN_INPUT, hpdViolationsOpen: 0, hpdViolationsClosed: 50 });
    expect(r.score).toBe(100); // already at max — bonus is clamped
    const r2 = computeScore({ ...CLEAN_INPUT, hpdViolationsOpen: 2, hpdViolationsClosed: 50 });
    expect(r2.score).toBeGreaterThan(98); // tiny penalty for 2 open offset by +2 bonus
  });

  it('clamps score at 0 for buildings with everything wrong', () => {
    const r = computeScore({
      hpdViolationsOpen: 200,
      hpdViolationsClosed: 0,
      dobComplaints: 200,
      evictions: 30,
      bedbugReports: 30,
      leadFlags: 30,
      watchlistRank: 1,
      fareFlag: 'possible_violation',
      scrapedListing: null,
    });
    expect(r.score).toBe(0);
    expect(r.band).toBe('high');
  });

  it('returns factors[] sorted by absolute impact (most-negative first)', () => {
    const r = computeScore({
      ...CLEAN_INPUT,
      hpdViolationsOpen: 12,
      evictions: 1,
      bedbugReports: 8,
      watchlistRank: 5,
    });
    // Watchlist top-10 (-30) should be the biggest impact
    expect(r.factors[0]?.key).toBe('watchlist_rank');
    expect(r.factors[0]?.impact).toBe(-30);
    // Then HPD open (-12)
    expect(r.factors[1]?.key).toBe('hpd_violations_open');
  });

  it('factor reasons are human-readable with literal counts', () => {
    const r = computeScore({ ...CLEAN_INPUT, hpdViolationsOpen: 12, evictions: 1 });
    expect(r.factors.some((f) => f.reason === '12 open HPD violations')).toBe(true);
    expect(r.factors.some((f) => f.reason === '1 marshal eviction on file')).toBe(true);
  });

  it('handles plural/singular correctly', () => {
    const r1 = computeScore({ ...CLEAN_INPUT, hpdViolationsOpen: 1 });
    const r2 = computeScore({ ...CLEAN_INPUT, hpdViolationsOpen: 12 });
    expect(r1.factors.find((f) => f.key === 'hpd_violations_open')?.reason).toContain('1 open HPD violation');
    expect(r1.factors.find((f) => f.key === 'hpd_violations_open')?.reason).not.toContain('violations');
    expect(r2.factors.find((f) => f.key === 'hpd_violations_open')?.reason).toContain('violations');
  });

  it('always emits a factor for every checked dimension (positive or zero)', () => {
    const r = computeScore(CLEAN_INPUT);
    const keys = r.factors.map((f) => f.key);
    expect(keys).toContain('hpd_violations_open');
    expect(keys).toContain('evictions');
    expect(keys).toContain('watchlist_rank');
  });

  it('boundary tests for band cutoffs', () => {
    expect(computeScore({ ...CLEAN_INPUT, hpdViolationsOpen: 21 }).band).toBe('moderate'); // 79
    // 100 - 25 - 15 = 60, exactly the moderate boundary (>= 60)
    expect(
      computeScore({
        ...CLEAN_INPUT,
        hpdViolationsOpen: 25,
        evictions: 5,
      }).band,
    ).toBe('moderate');
    // 100 - 25 - 15 - 1 = 59, into elevated
    expect(
      computeScore({
        ...CLEAN_INPUT,
        hpdViolationsOpen: 25,
        evictions: 5,
        bedbugReports: 1,
      }).band,
    ).toBe('elevated');
  });
});

describe('bandLabel', () => {
  it('returns human-readable copy', () => {
    expect(bandLabel('minimal')).toBe('Minimal concern');
    expect(bandLabel('moderate')).toBe('Moderate concern');
    expect(bandLabel('elevated')).toBe('Elevated concern');
    expect(bandLabel('high')).toBe('High concern');
  });
});
