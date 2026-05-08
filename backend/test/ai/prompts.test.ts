import { describe, it, expect } from 'vitest';
import { buildUserPrompt, SYSTEM_PROMPT, type BuildingPayload } from '../../src/ai/prompts/lookup-summary.js';

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
    expect(prompt).toContain('Listing copy');
    expect(prompt).toContain('provided by renter'); // when no scrapedListing → user-pasted label
    expect(prompt).toContain('"""');
    expect(prompt).toContain(listing);
  });

  it('uses "scraped verbatim" label when scrapedListing is also present', () => {
    const listing = 'Spacious 1BR. No broker fee.';
    const prompt = buildUserPrompt({
      ...BASE,
      listingText: listing,
      scrapedListing: {
        url: 'https://x.com/y',
        source: 'streeteasy',
        source_kind: 'rental',
        address: '1 Main St',
        unit: null,
        monthlyRentCents: null,
        bedrooms: null,
        bathrooms: null,
        squareFeet: null,
        brokerFeeStated: 'unknown',
        brokerFeeText: null,
        securityDepositText: null,
        leaseTermMonths: null,
        petsPolicy: null,
        utilitiesIncluded: [],
        amenities: [],
        availabilityDate: null,
        daysOnMarket: null,
      },
    });
    expect(prompt).toContain('scraped verbatim');
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

  it('emits a "Listing facts" block when scrapedListing is provided', () => {
    const prompt = buildUserPrompt({
      ...BASE,
      scrapedListing: {
        url: 'https://streeteasy.com/building/x/y',
        source: 'streeteasy',
        source_kind: 'rental',
        address: '350 5th Ave',
        unit: '1A',
        monthlyRentCents: 450000, // $4,500/mo
        bedrooms: 2,
        bathrooms: 1,
        squareFeet: 850,
        brokerFeeStated: 'no_fee',
        brokerFeeText: 'No broker fee',
        securityDepositText: null,
        leaseTermMonths: 12,
        petsPolicy: 'cats only',
        utilitiesIncluded: ['heat', 'water'],
        amenities: ['doorman', 'gym'],
        availabilityDate: '2026-06-01',
        daysOnMarket: 14,
      },
    });
    expect(prompt).toContain('Listing facts (scraped from');
    expect(prompt).toContain('streeteasy/rental');
    expect(prompt).toContain('Asking rent: $4,500/mo');
    expect(prompt).toContain('Layout: 2 bed / 1 bath / 850 sqft');
    expect(prompt).toContain('Broker fee status: no_fee');
    expect(prompt).toContain('Utilities included: heat, water');
    expect(prompt).toContain('Available: 2026-06-01');
  });

  it('omits the "Listing facts" block when scrapedListing is null', () => {
    const prompt = buildUserPrompt(BASE);
    expect(prompt).not.toContain('Listing facts (scraped from');
  });

  it('renders studio (bedrooms=0) without saying "0 bed"', () => {
    const prompt = buildUserPrompt({
      ...BASE,
      scrapedListing: {
        url: 'https://x.com/y',
        source: 'streeteasy',
        source_kind: 'rental',
        address: '1 Main St',
        unit: null,
        monthlyRentCents: 250000,
        bedrooms: 0,
        bathrooms: 1,
        squareFeet: null,
        brokerFeeStated: 'unknown',
        brokerFeeText: null,
        securityDepositText: null,
        leaseTermMonths: null,
        petsPolicy: null,
        utilitiesIncluded: [],
        amenities: [],
        availabilityDate: null,
        daysOnMarket: null,
      },
    });
    expect(prompt).toContain('Layout: studio / 1 bath');
    expect(prompt).not.toContain('0 bed');
  });

  it('reminder line about NEVER characterizing rent appears in user prompt', () => {
    const prompt = buildUserPrompt(BASE);
    expect(prompt).toMatch(/never\s+characterize\s+the\s+rent/i);
  });

  it('omits per-apartment block when apartmentRisks is empty', () => {
    const prompt = buildUserPrompt({ ...BASE, apartmentRisks: [] });
    expect(prompt).not.toContain('Per-apartment issue records');
  });

  it('omits per-apartment block when apartmentRisks is null/undefined', () => {
    const prompt = buildUserPrompt({ ...BASE, apartmentRisks: null });
    expect(prompt).not.toContain('Per-apartment issue records');
    const prompt2 = buildUserPrompt(BASE);
    expect(prompt2).not.toContain('Per-apartment issue records');
  });

  it('includes per-apartment block when apartmentRisks is non-empty', () => {
    const prompt = buildUserPrompt({
      ...BASE,
      apartmentRisks: [
        {
          apt: '2L',
          issues: [
            { source: 'hpd', cls: 'B', status: 'Open', date: '2026-04-27T00:00:00.000Z', description: 'LEAK FROM ABOVE' },
            { source: 'hpd', cls: 'B', status: 'CLOSE', date: '2024-01-01T00:00:00.000Z', description: 'OLD ISSUE' },
          ],
        },
        {
          apt: '1L',
          issues: [
            { source: 'eviction', date: '2025-03-01T00:00:00.000Z', description: 'HOLDOVER' },
          ],
        },
      ],
    });
    expect(prompt).toContain('Per-apartment issue records');
    expect(prompt).toContain('Apt 2L:');
    expect(prompt).toContain('Apt 1L:');
    expect(prompt).toContain('LEAK FROM ABOVE');
    // open status is included in output
    expect(prompt).toContain('open');
    // CLOSE status is NOT emitted as "open"
    const lines = prompt.split('\n');
    const closedLine = lines.find((l) => l.includes('OLD ISSUE'));
    expect(closedLine).not.toContain('open');
  });

  it('SYSTEM_PROMPT is static (contains no per-request data)', () => {
    // System prompt must not reference any specific BBL, address, or stats
    expect(SYSTEM_PROMPT).not.toMatch(/\b\d{10}\b/); // no 10-digit BBL
    expect(SYSTEM_PROMPT).not.toContain('HPD violations: ');
    expect(SYSTEM_PROMPT).not.toContain('Public records (last');
  });

  it('system prompt includes at_risk_apartments section rules', () => {
    expect(SYSTEM_PROMPT).toContain('[at_risk_apartments]');
    expect(SYSTEM_PROMPT).toContain('"apt"');
  });
});
