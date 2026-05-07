import { describe, it, expect } from 'vitest';
import { extractZillow, matchZillow } from '../../../src/scraping/extractors/zillow.js';

const URL = 'https://www.zillow.com/homedetails/444-W-49th-St-APT-1D-New-York-NY-10019/2113497722_zpid/';

describe('matchZillow', () => {
  it('matches zillow + www.zillow', () => {
    expect(matchZillow(new URL_('https://zillow.com/x'))).toBe(true);
    expect(matchZillow(new URL_('https://www.zillow.com/x'))).toBe(true);
  });

  it('rejects other hosts', () => {
    expect(matchZillow(new URL_('https://www.streeteasy.com/x'))).toBe(false);
  });
});

// Use global URL constructor (test-file shadowing the import)
const URL_ = globalThis.URL;

describe('extractZillow — bot-wall handling', () => {
  it('returns null when Zillow served an empty page (typical bot block)', () => {
    const blockedHtml = '<html lang="en"><head></head></html>';
    expect(extractZillow(blockedHtml, URL)).toBeNull();
  });

  it('returns null when ONLY og:title is present (just address, no rich data)', () => {
    // The classic "we got past the WAF but Zillow withheld JSON-LD" case
    const html = `<html><head>
      <meta property="og:title" content="444 W 49th St APT 1D, New York, NY 10019 | Zillow">
      <meta property="og:description" content="Zillow has more rental listings than any other site...">
    </head><body></body></html>`;
    expect(extractZillow(html, URL)).toBeNull();
  });

  it('extracts when JSON-LD Apartment is present even without __NEXT_DATA__', () => {
    const html = `<html><head>
      <script type="application/ld+json">
      {"@context":"https://schema.org","@type":"Apartment",
       "address":{"@type":"PostalAddress","streetAddress":"444 W 49th St APT 1D","addressLocality":"New York","addressRegion":"NY","postalCode":"10019"},
       "description":"A nice apartment in Hell's Kitchen with hardwood floors.",
       "numberOfBedrooms":1}
      </script>
    </head><body></body></html>`;
    const r = extractZillow(html, URL);
    expect(r).not.toBeNull();
    expect(r?.address).toContain('444 W 49th St');
    expect(r?.description).toContain("Hell's Kitchen");
    expect(r?.bedrooms).toBe(1);
  });

  it('accepts og:description with property-specific signals (digit-form bed/bath count or $rent)', () => {
    // Zillow's actual og:description format: "This is a X bedroom, Y bathroom, Apartment home."
    const html = `<html><head>
      <meta property="og:title" content="444 W 49th St APT 1D, New York, NY 10019">
      <meta property="og:description" content="This is a 1 bedroom, 1 bathroom, Apartment home. It is located at 444 W 49th St APT 1D, New York, NY.">
    </head><body></body></html>`;
    const r = extractZillow(html, URL);
    expect(r).not.toBeNull();
    expect(r?.address).toContain('444 W 49th St');
    expect(r?.bedrooms).toBe(1);
    expect(r?.bathrooms).toBe(1);
  });

  it('also accepts og:description with explicit /mo rent as a property signal', () => {
    const html = `<html><head>
      <meta property="og:title" content="444 W 49th St APT 1D, New York, NY 10019">
      <meta property="og:description" content="A spacious one-bedroom apartment available at $2,550/mo near Times Square.">
    </head><body></body></html>`;
    const r = extractZillow(html, URL);
    expect(r).not.toBeNull();
  });

  it('rejects og:description that is just the generic Zillow tagline', () => {
    const html = `<html><head>
      <meta property="og:title" content="444 W 49th St APT 1D, New York, NY 10019">
      <meta property="og:description" content="Spacious one-bedroom in a doorman building near Times Square with washer and dryer.">
    </head><body></body></html>`;
    // No digit-form bed/bath count, no $, no /mo → not rich enough
    const r = extractZillow(html, URL);
    expect(r).toBeNull();
  });
});
