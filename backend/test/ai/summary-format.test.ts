import { describe, it, expect } from 'vitest';
import { isCurrentSummaryFormat } from '../../src/ai/summary-format.js';

describe('isCurrentSummaryFormat', () => {
  it('rejects null and empty', () => {
    expect(isCurrentSummaryFormat(null)).toBe(false);
    expect(isCurrentSummaryFormat(undefined)).toBe(false);
    expect(isCurrentSummaryFormat('')).toBe(false);
  });

  it('rejects pre-PR-#15 4-dataset walkthrough output (no markers)', () => {
    const old =
      'This building has 26 open HPD violations, indicating unresolved maintenance issues that the landlord has not corrected. There are 23 DOB complaints filed in the last year, suggesting recent construction or safety concerns. The building has 2 executed marshal evictions on file, which may indicate some enforcement history by the landlord. The registered owner is not on the current Worst Landlord Watchlist, meaning they have not been flagged as one of the city\'s worst-rated landlords for the year. Always check the cited records yourself before relying on anything in this summary.';
    expect(isCurrentSummaryFormat(old)).toBe(false);
  });

  it('accepts the at-risk-apartments format', () => {
    const current =
      'The building shows a recent pattern of unresolved maintenance risk, especially around water leaks and plaster damage.\n\nAt-risk apartments:\n- Apt. 2L: Most concerning. Recent open Class B HPD violations for water leak source.\n- Apt. 1L: Older safety/maintenance issues.\n\nAlways check the cited records yourself before relying on anything in this summary.';
    expect(isCurrentSummaryFormat(current)).toBe(true);
  });

  it('accepts the empty-list format when no apartment recurs', () => {
    const current =
      'The records show only isolated incidents with no recurring pattern across units.\n\nAt-risk apartments:\n- No specific units recurred across recent records.\n\nAlways check the cited records yourself before relying on anything in this summary.';
    expect(isCurrentSummaryFormat(current)).toBe(true);
  });
});
