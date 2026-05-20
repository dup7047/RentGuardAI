import { describe, it, expect } from 'vitest';
import { canonicalizeListingUrl, detectListingHost } from '../../src/scraping/url-canonicalize.js';

describe('canonicalizeListingUrl', () => {
  it('strips utm_* tracking params', () => {
    expect(canonicalizeListingUrl('https://streeteasy.com/rental/123?utm_source=email&utm_medium=cta')).toBe(
      'https://streeteasy.com/rental/123',
    );
  });

  it('strips fbclid and gclid', () => {
    expect(canonicalizeListingUrl('https://streeteasy.com/rental/123?fbclid=abc&gclid=xyz')).toBe(
      'https://streeteasy.com/rental/123',
    );
  });

  it('preserves non-tracking query params', () => {
    expect(canonicalizeListingUrl('https://streeteasy.com/search?bed=2&utm_source=email')).toBe(
      'https://streeteasy.com/search?bed=2',
    );
  });

  it('drops the URL hash', () => {
    expect(canonicalizeListingUrl('https://streeteasy.com/rental/123#gallery')).toBe(
      'https://streeteasy.com/rental/123',
    );
  });

  it('lowercases the host', () => {
    expect(canonicalizeListingUrl('https://STREETEASY.com/rental/123')).toBe(
      'https://streeteasy.com/rental/123',
    );
  });

  it('drops trailing slash on path (but not on root)', () => {
    expect(canonicalizeListingUrl('https://streeteasy.com/rental/123/')).toBe(
      'https://streeteasy.com/rental/123',
    );
    expect(canonicalizeListingUrl('https://streeteasy.com/')).toBe('https://streeteasy.com/');
  });

  it('combines all transforms in one shot', () => {
    // Host lowercased, path case preserved, tracking params dropped, hash dropped, trailing slash removed
    expect(
      canonicalizeListingUrl('https://STREETEASY.com/RENTAL/123/?utm_source=email&fbclid=abc#gallery'),
    ).toBe('https://streeteasy.com/RENTAL/123');
  });

  it('returns trimmed input when URL parsing fails', () => {
    expect(canonicalizeListingUrl('  not a url  ')).toBe('not a url');
  });

  it('drops default ports (:443 https)', () => {
    expect(canonicalizeListingUrl('https://streeteasy.com:443/rental/123')).toBe(
      'https://streeteasy.com/rental/123',
    );
  });
});

describe('detectListingHost', () => {
  it('matches StreetEasy main domain', () => {
    expect(detectListingHost('https://streeteasy.com/rental/1')?.source).toBe('streeteasy');
  });

  it('matches StreetEasy with www', () => {
    expect(detectListingHost('https://www.streeteasy.com/rental/1')?.source).toBe('streeteasy');
  });

  it('matches Zillow', () => {
    expect(detectListingHost('https://www.zillow.com/homedetails/123')?.source).toBe('zillow');
  });

  it('returns null for unknown hosts (SSRF guard)', () => {
    expect(detectListingHost('https://renthop.com/listing/abc')).toBeNull();
    expect(detectListingHost('https://newyork.craigslist.org/abc')).toBeNull();
    expect(detectListingHost('http://127.0.0.1/')).toBeNull();
    expect(detectListingHost('http://169.254.169.254/latest/meta-data/')).toBeNull();
    expect(detectListingHost('http://10.0.0.5:6379/')).toBeNull();
  });

  it('returns null for non-http(s) schemes', () => {
    expect(detectListingHost('file:///etc/passwd')).toBeNull();
    expect(detectListingHost('ftp://streeteasy.com/rental/1')).toBeNull();
  });

  it('returns null for unparseable URLs', () => {
    expect(detectListingHost('not a url')).toBeNull();
  });
});
