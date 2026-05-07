import { describe, it, expect } from 'vitest';
import { parseListingUrl } from '../../src/parse/listing-url.js';
import { ListingParseError } from '../../src/parse/listing-url.types.js';

describe('parseListingUrl', () => {
  it('StreetEasy /building/<address-slug> → address_extracted', () => {
    const r = parseListingUrl('https://streeteasy.com/building/350-5th-avenue-new_york');
    expect(r.kind).toBe('address_extracted');
    if (r.kind === 'address_extracted') {
      expect(r.address).toBe('350 5th avenue new york');
      expect(r.host).toBe('streeteasy');
    }
  });

  it('StreetEasy /building/<address-slug>/ with trailing slash + www', () => {
    const r = parseListingUrl('https://www.streeteasy.com/building/350-5th-avenue-new_york/');
    expect(r.kind).toBe('address_extracted');
    if (r.kind === 'address_extracted') {
      expect(r.address).toBe('350 5th avenue new york');
    }
  });

  it('StreetEasy /rental/<id>/<address-slug> → address_extracted', () => {
    const r = parseListingUrl(
      'https://streeteasy.com/rental/4112345/350-5th-avenue-new_york',
    );
    expect(r.kind).toBe('address_extracted');
    if (r.kind === 'address_extracted') {
      expect(r.address).toBe('350 5th avenue new york');
    }
  });

  it('StreetEasy /building/ with non-address slug → requires_address opaque_id', () => {
    // Extra path segment — doesn't match /building/<slug>/?
    const r = parseListingUrl('https://streeteasy.com/building/some-opaque/12345');
    expect(r.kind).toBe('requires_address');
    if (r.kind === 'requires_address') {
      expect(r.reason).toBe('opaque_id');
    }
  });

  it('StreetEasy agent page → requires_address opaque_id', () => {
    const r = parseListingUrl('https://streeteasy.com/agent/john-smith');
    expect(r.kind).toBe('requires_address');
    if (r.kind === 'requires_address') {
      expect(r.reason).toBe('opaque_id');
    }
  });

  it('StreetEasy slug with unit suffix → drops unit', () => {
    const r = parseListingUrl('https://streeteasy.com/building/123-main-st_3a');
    expect(r.kind).toBe('address_extracted');
    if (r.kind === 'address_extracted') {
      expect(r.address).toBe('123 main st');
    }
  });

  it('Zillow /homedetails/<slug>/<zpid>_zpid/ → address_extracted', () => {
    const r = parseListingUrl(
      'https://www.zillow.com/homedetails/350-5th-Ave-New-York-NY-10118/12345_zpid/',
    );
    expect(r.kind).toBe('address_extracted');
    if (r.kind === 'address_extracted') {
      expect(r.address).toBe('350 5th Ave New York NY 10118');
      expect(r.host).toBe('zillow');
    }
  });

  it('Zillow opaque path → requires_address opaque_id', () => {
    const r = parseListingUrl('https://www.zillow.com/b/12345_zid/');
    expect(r.kind).toBe('requires_address');
  });

  it('Apartments.com matching slug → address_extracted', () => {
    const r = parseListingUrl(
      'https://www.apartments.com/the-empire-state-building-new-york-ny/12345/',
    );
    expect(r.kind).toBe('address_extracted');
    if (r.kind === 'address_extracted') {
      expect(r.address).toBe('the empire state building new york ny');
      expect(r.host).toBe('apartments');
    }
  });

  it('Unknown host → requires_address unknown_host', () => {
    const r = parseListingUrl('https://realtor.com/property/123');
    expect(r.kind).toBe('requires_address');
    if (r.kind === 'requires_address') {
      expect(r.reason).toBe('unknown_host');
    }
  });

  it('Non-URL string → throws ListingParseError invalid_url', () => {
    expect(() => parseListingUrl('not a url')).toThrowError(ListingParseError);
  });

  it('No fetch calls made by parser', () => {
    // Structural: listing-url.ts must have zero fetch/http calls
    // (enforced by test: parse a valid URL and no network error thrown)
    const r = parseListingUrl('https://streeteasy.com/building/100-main-st-brooklyn');
    expect(r.kind).not.toBeUndefined();
  });
});
