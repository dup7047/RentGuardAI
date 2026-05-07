import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractStreetEasy, matchStreetEasy } from '../../../src/scraping/extractors/streeteasy.js';

const FIXTURE = readFileSync(
  join(import.meta.dirname, '../fixtures/streeteasy-rental-210e22.html'),
  'utf8',
);

describe('matchStreetEasy', () => {
  it('matches streeteasy.com + www.streeteasy.com', () => {
    expect(matchStreetEasy(new URL('https://streeteasy.com/rental/1'))).toBe(true);
    expect(matchStreetEasy(new URL('https://www.streeteasy.com/rental/1'))).toBe(true);
  });

  it('rejects other hosts', () => {
    expect(matchStreetEasy(new URL('https://www.zillow.com/x'))).toBe(false);
  });
});

describe('extractStreetEasy (real fixture)', () => {
  const url = 'https://streeteasy.com/building/210-east-22-street-new_york/1k';
  const result = extractStreetEasy(FIXTURE, url);

  it('returns a non-null result on a real rental page', () => {
    expect(result).not.toBeNull();
  });

  it('classifies the URL as a rental', () => {
    expect(result?.source_kind).toBe('rental');
  });

  it('extracts the canonical address with unit', () => {
    expect(result?.address).toContain('210 East 22nd Street #1K');
    expect(result?.address).toContain('NY');
    expect(result?.unit).toBe('1K');
  });

  it('extracts the monthly rent in cents', () => {
    expect(result?.monthlyRentCents).toBe(582500); // $5,825/mo
  });

  it('extracts bedrooms and bathrooms from the formatted Next.js stream', () => {
    expect(result?.bedrooms).toBe(2);
    expect(result?.bathrooms).toBe(1);
  });

  it('extracts amenities from amenityFeature[]', () => {
    expect(result?.amenities).toEqual(
      expect.arrayContaining(['doorman', 'gym', 'dishwasher', 'washer dryer']),
    );
  });

  it('extracts the listing description', () => {
    expect(result?.description?.length).toBeGreaterThan(500);
    expect(result?.description).toContain('beautiful 2 Bedroom');
  });

  it('extracts the availability date', () => {
    expect(result?.availabilityDate).toBe('2026-05-01');
  });

  it('reports high confidence when address + price + beds are all present', () => {
    expect(result?.confidence).toBe('high');
  });

  it('caps description at the storage limit', () => {
    // The test fixture is shorter than the cap, but make sure short input
    // doesn't trigger truncation
    expect(result?.description?.length).toBeLessThanOrEqual(8000);
  });

  it('detects /sale/ URLs as sale (no rent)', () => {
    const r = extractStreetEasy(FIXTURE, 'https://streeteasy.com/sale/12345');
    expect(r?.source_kind).toBe('sale');
    expect(r?.monthlyRentCents).toBeNull();
  });

  it('returns null when html has no JSON-LD or formatted block', () => {
    const r = extractStreetEasy('<html><body>nothing here</body></html>', 'https://streeteasy.com/x');
    expect(r).toBeNull();
  });
});
