import { describe, it, expect } from 'vitest';
import { extractGeneric } from '../../../src/scraping/extractors/generic.js';

const HTML_WITH_JSONLD = `<!DOCTYPE html><html><head>
  <meta property="og:title" content="123 Main St, Brooklyn, NY 11211">
  <meta property="og:description" content="Charming 1BR in Williamsburg.">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Apartment",
    "name": "Charming 1BR",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "123 Main St",
      "addressLocality": "Brooklyn",
      "addressRegion": "NY",
      "postalCode": "11211"
    },
    "description": "A nice apartment.",
    "offers": { "@type": "Offer", "price": 3000, "priceCurrency": "USD" }
  }
  </script>
</head><body></body></html>`;

const HTML_OG_ONLY = `<html><head>
  <meta property="og:title" content="500 5th Ave, New York, NY">
  <meta property="og:description" content="Studio for rent.">
</head><body></body></html>`;

const HTML_EMPTY = '<html><head></head><body></body></html>';

describe('extractGeneric', () => {
  it('parses JSON-LD Apartment with address + price + description', () => {
    const r = extractGeneric(HTML_WITH_JSONLD, 'https://example.com/listing/1');
    expect(r).not.toBeNull();
    expect(r?.address).toBe('123 Main St, Brooklyn, NY, 11211');
    expect(r?.monthlyRentCents).toBe(300000); // $3,000
    expect(r?.description).toBe('A nice apartment.');
    expect(r?.title).toBe('Charming 1BR');
    expect(r?.confidence).toBe('low'); // generic always low
  });

  it('falls back to og:title when JSON-LD is absent', () => {
    const r = extractGeneric(HTML_OG_ONLY, 'https://example.com/listing/2');
    expect(r).not.toBeNull();
    expect(r?.address).toBe('500 5th Ave, New York, NY');
    expect(r?.description).toBe('Studio for rent.');
  });

  it('returns null when neither OG nor JSON-LD is present', () => {
    expect(extractGeneric(HTML_EMPTY, 'https://example.com/x')).toBeNull();
  });

  it('rejects implausibly large prices (sale prices accidentally captured as rent)', () => {
    const html = HTML_WITH_JSONLD.replace('"price": 3000', '"price": 1500000');
    const r = extractGeneric(html, 'https://example.com/x');
    // Generic shouldn't surface what looks like a sale price as monthly rent
    expect(r?.monthlyRentCents).toBeNull();
  });

  it('source is always "generic"', () => {
    const r = extractGeneric(HTML_WITH_JSONLD, 'https://example.com/x');
    expect(r?.source).toBe('generic');
  });
});
