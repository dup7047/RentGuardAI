import { describe, it, expect } from 'vitest';
import { parseAddressFromUrl } from '../../src/scraping/slug-parse.js';

describe('parseAddressFromUrl — Zillow', () => {
  it('parses /homedetails with APT unit + city + state + zip', () => {
    expect(
      parseAddressFromUrl(
        'https://www.zillow.com/homedetails/127-W-81st-St-APT-4B-New-York-NY-10024/12345_zpid/',
        'zillow',
      ),
    ).toBe('127 W 81st St, New York, NY 10024');
  });

  it('parses /homedetails without unit, with borough name as city', () => {
    expect(
      parseAddressFromUrl(
        'https://www.zillow.com/homedetails/127-W-81st-St-Manhattan-NY-10024/12345_zpid/',
        'zillow',
      ),
    ).toBe('127 W 81st St, Manhattan, NY 10024');
  });

  it('parses /homedetails with neighborhood (not borough) as city when APT is present', () => {
    // Regression: Ridgewood is a Queens neighborhood, not a borough. Before
    // the APT-aware split this returned null because Ridgewood wasn't in
    // the borough allowlist.
    expect(
      parseAddressFromUrl(
        'https://www.zillow.com/homedetails/1823-Menahan-St-APT-1L-Ridgewood-NY-11385/2101423184_zpid/',
        'zillow',
      ),
    ).toBe('1823 Menahan St, Ridgewood, NY 11385');
  });

  it('parses multi-token neighborhood (Long Island City) when APT is present', () => {
    expect(
      parseAddressFromUrl(
        'https://www.zillow.com/homedetails/2425-Vernon-Blvd-APT-3-Long-Island-City-NY-11101/12345_zpid/',
        'zillow',
      ),
    ).toBe('2425 Vernon Blvd, Long Island City, NY 11101');
  });

  it('parses /homedetails when state has no zip suffix', () => {
    expect(
      parseAddressFromUrl(
        'https://www.zillow.com/homedetails/127-W-81st-St-Brooklyn-NY/12345_zpid/',
        'zillow',
      ),
    ).toBe('127 W 81st St, Brooklyn, NY');
  });

  it('parses /b/ building pages', () => {
    expect(
      parseAddressFromUrl(
        'https://www.zillow.com/b/127-W-81st-St-New-York-NY-bb1234/',
        'zillow',
      ),
    ).toBe('127 W 81st St, New York, NY');
  });

  it('returns null for non-NY URLs', () => {
    expect(
      parseAddressFromUrl(
        'https://www.zillow.com/homedetails/123-Main-St-Beverly-Hills-CA-90210/12345_zpid/',
        'zillow',
      ),
    ).toBeNull();
  });

  it('returns null when slug starts with a non-numeric building name', () => {
    expect(
      parseAddressFromUrl(
        'https://www.zillow.com/homedetails/Empire-State-Building-New-York-NY-10118/12345_zpid/',
        'zillow',
      ),
    ).toBeNull();
  });

  it('returns null when path is not a homedetails or /b/ URL', () => {
    expect(
      parseAddressFromUrl('https://www.zillow.com/community/some-place/', 'zillow'),
    ).toBeNull();
  });
});

describe('parseAddressFromUrl — StreetEasy', () => {
  it('parses /building/<slug> with new_york city', () => {
    expect(
      parseAddressFromUrl(
        'https://streeteasy.com/building/127-w-81st-street-new_york',
        'streeteasy',
      ),
    ).toBe('127 W 81st Street, New York, NY');
  });

  it('parses /building/<slug> with single-word borough city', () => {
    expect(
      parseAddressFromUrl(
        'https://streeteasy.com/building/350-fifth-avenue-manhattan',
        'streeteasy',
      ),
    ).toBe('350 Fifth Avenue, Manhattan, NY');
  });

  it('parses /building/<slug> with staten_island', () => {
    expect(
      parseAddressFromUrl(
        'https://streeteasy.com/building/100-bay-street-staten_island',
        'streeteasy',
      ),
    ).toBe('100 Bay Street, Staten Island, NY');
  });

  it('returns null for /rental/<id> (no address in slug)', () => {
    expect(
      parseAddressFromUrl('https://streeteasy.com/rental/3543126', 'streeteasy'),
    ).toBeNull();
  });

  it('returns null when last token is not a recognized NYC city', () => {
    expect(
      parseAddressFromUrl(
        'https://streeteasy.com/building/127-w-81st-street-jersey_city',
        'streeteasy',
      ),
    ).toBeNull();
  });

  it('returns null when first token is a building name', () => {
    expect(
      parseAddressFromUrl(
        'https://streeteasy.com/building/the-eldorado-new_york',
        'streeteasy',
      ),
    ).toBeNull();
  });
});

describe('parseAddressFromUrl — generic / unsupported', () => {
  it('returns null for generic source', () => {
    expect(
      parseAddressFromUrl('https://example.com/listings/123', 'generic'),
    ).toBeNull();
  });
});
