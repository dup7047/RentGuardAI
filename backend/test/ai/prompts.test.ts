import { describe, it, expect } from 'vitest';
import { buildUserPrompt, type BuildingPayload } from '../../src/ai/prompts/lookup-summary.js';

const BASE: BuildingPayload = {
  bbl: '1008350041',
  address: '350 5 AVENUE, New York, NY, USA',
  borough: 'MANHATTAN',
  hpdViolations: { open: 0, closed: 0 },
  dobComplaints: 0,
  evictions: 0,
  bedbugReports: 0,
  leadFlags: 0,
  registeredOwner: null,
  watchlistRank: null,
};

describe('buildUserPrompt', () => {
  it('includes the bare records when no listing text is provided', () => {
    const prompt = buildUserPrompt(BASE);
    expect(prompt).toContain('350 5 AVENUE');
    expect(prompt).toContain('BBL 1008350041');
    expect(prompt).toContain('No listing copy was provided');
    expect(prompt).toContain('"listing_notes": []');
    // FARE line absent when not supplied
    expect(prompt).not.toContain('FARE Act pre-check');
  });

  it('embeds listing copy verbatim inside triple-quoted block', () => {
    const listing = 'Spacious 1BR in Chelsea. No broker fee. Tenant pays utilities.';
    const prompt = buildUserPrompt({ ...BASE, listingText: listing });
    expect(prompt).toContain('Listing copy provided by the renter');
    expect(prompt).toContain('"""');
    expect(prompt).toContain(listing);
  });

  it('truncates listing copy at 4000 chars to bound prompt size', () => {
    const longListing = 'A'.repeat(5000);
    const prompt = buildUserPrompt({ ...BASE, listingText: longListing });
    // The full 5000-char block should NOT appear; the 4000-char prefix should
    expect(prompt).toContain('A'.repeat(4000));
    expect(prompt).not.toContain('A'.repeat(4001));
  });

  it('surfaces the FARE flag for the AI to cross-reference', () => {
    const prompt = buildUserPrompt({ ...BASE, fareFlag: 'possible_violation' });
    expect(prompt).toContain('FARE Act pre-check on the listing copy: possible_violation');
  });

  it('handles all FARE flag values', () => {
    for (const flag of ['no_indicators', 'possible_violation', 'unclear'] as const) {
      const prompt = buildUserPrompt({ ...BASE, fareFlag: flag });
      expect(prompt).toContain(`FARE Act pre-check on the listing copy: ${flag}`);
    }
  });

  it('treats whitespace-only listingText as no listing', () => {
    const prompt = buildUserPrompt({ ...BASE, listingText: '   \n\t  ' });
    expect(prompt).toContain('No listing copy was provided');
  });

  it('always cites the four canonical NYC Open Data + advocate URLs', () => {
    const prompt = buildUserPrompt(BASE);
    expect(prompt).toContain('wvxf-dwi5'); // HPD violations
    expect(prompt).toContain('eabe-havv'); // DOB complaints
    expect(prompt).toContain('6z8x-wfk4'); // Marshal evictions
    expect(prompt).toContain('advocate.nyc.gov/landlord-watchlist'); // Watchlist
  });
});
