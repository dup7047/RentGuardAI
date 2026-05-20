import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { scrapeListing } from '../../src/scraping/fetcher.js';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// We mock cache.ts (so no DB), firecrawl-client.ts (so no real Firecrawl call),
// and global.fetch (so no real network).
vi.mock('../../src/scraping/cache.js', () => ({
  getCached: vi.fn().mockResolvedValue(null),
  setCached: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/scraping/firecrawl-client.js', () => ({
  firecrawlFetch: vi.fn(),
  isFirecrawlAvailable: vi.fn().mockReturnValue(true),
  FirecrawlError: class extends Error {
    constructor(
      msg: string,
      public readonly status?: number,
      public readonly code?: 'no_api_key' | 'quota_exceeded' | 'http_error' | 'timeout',
    ) {
      super(msg);
      this.name = 'FirecrawlError';
    }
  },
}));

import * as cache from '../../src/scraping/cache.js';
import * as firecrawl from '../../src/scraping/firecrawl-client.js';

// Simple StreetEasy-shaped HTML that the extractor can parse
const GOOD_STREETEASY_HTML = `<!DOCTYPE html><html><head>
  <meta property="og:title" content="123 Main St #2A | StreetEasy">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@graph":[
    {"@type":"Apartment",
     "address":{"@type":"PostalAddress","streetAddress":"123 Main St #2A","addressLocality":"NEW YORK","addressRegion":"NY","postalCode":"10001"},
     "additionalProperty":[{"@type":"PropertyValue","name":"Monthly Rent","value":"$3,500/mo"}],
     "amenityFeature":[{"name":"doorman","value":true}],
     "event":[{"description":"Nice apartment.","offers":{"price":3500,"validFrom":"2026-06-01"}}]}
  ]}
  </script>
  <script>self.__next_f.push([1, "\\"formattedBedrooms\\":\\"1 beds\\",\\"formattedBathrooms\\":\\"1 bath\\""])</script>
  <body>${'.'.repeat(3000)}</body>
</html>`;

const CLOUDFLARE_CHALLENGE_HTML = `<!DOCTYPE html><html><head>
  <title>Just a moment...</title>
</head><body>Verifying you are human.</body></html>`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cache.getCached).mockResolvedValue(null);
  vi.mocked(cache.setCached).mockResolvedValue(undefined);
  vi.mocked(firecrawl.isFirecrawlAvailable).mockReturnValue(true);
});

afterEach(() => vi.restoreAllMocks());

describe('scrapeListing', () => {
  it('returns cache hit immediately without fetching', async () => {
    const cached = {
      data: {
        url: 'https://streeteasy.com/x',
        source: 'streeteasy' as const,
        source_kind: 'rental' as const,
        fetchedAt: new Date().toISOString(),
        address: '1 Main St',
        unit: null,
        monthlyRentCents: 100000,
        bedrooms: null,
        bathrooms: null,
        squareFeet: null,
        brokerFeeStated: 'unknown' as const,
        brokerFeeText: null,
        securityDepositText: null,
        leaseTermMonths: null,
        petsPolicy: null,
        utilitiesIncluded: [],
        amenities: [],
        availabilityDate: null,
        description: null,
        title: null,
        daysOnMarket: null,
        agentName: null,
        brokerage: null,
        confidence: 'high' as const,
      },
      fetched_at: new Date().toISOString(),
      fetch_method: 'direct' as const,
    };
    vi.mocked(cache.getCached).mockResolvedValue(cached);
    const fetchSpy = vi.spyOn(global, 'fetch');

    const r = await scrapeListing('https://streeteasy.com/rental/1');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.fetchMethod).toBe('cache');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(firecrawl.firecrawlFetch).not.toHaveBeenCalled();
  });

  it('direct fetch success → no Firecrawl call, returns ok with fetchMethod=direct', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(GOOD_STREETEASY_HTML, { status: 200 }),
    );
    const r = await scrapeListing('https://streeteasy.com/building/123-main/2a');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.fetchMethod).toBe('direct');
      expect(r.data.address).toContain('123 Main St');
      expect(r.data.monthlyRentCents).toBe(350000); // $3,500
    }
    expect(firecrawl.firecrawlFetch).not.toHaveBeenCalled();
  });

  it('Cloudflare challenge HTML triggers Firecrawl fallback', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(CLOUDFLARE_CHALLENGE_HTML, { status: 200 }),
    );
    vi.mocked(firecrawl.firecrawlFetch).mockResolvedValue({
      html: GOOD_STREETEASY_HTML,
      finalUrl: 'https://streeteasy.com/building/123-main/2a',
      statusCode: 200,
      costCredits: 3,
    });
    const r = await scrapeListing('https://streeteasy.com/building/123-main/2a');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') expect(r.fetchMethod).toBe('firecrawl');
    expect(firecrawl.firecrawlFetch).toHaveBeenCalledTimes(1);
  });

  it('direct returns 403 → Firecrawl fallback', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 403 }));
    vi.mocked(firecrawl.firecrawlFetch).mockResolvedValue({
      html: GOOD_STREETEASY_HTML,
      finalUrl: 'https://streeteasy.com/building/123-main/2a',
      statusCode: 200,
      costCredits: 3,
    });
    const r = await scrapeListing('https://streeteasy.com/building/123-main/2a');
    expect(r.kind).toBe('ok');
    expect(firecrawl.firecrawlFetch).toHaveBeenCalled();
  });

  it('direct returns 404 → listing_not_found (no Firecrawl call)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const r = await scrapeListing('https://streeteasy.com/building/x/9999');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') {
      expect(r.code).toBe('listing_not_found');
      expect(r.status).toBe(404);
    }
    expect(firecrawl.firecrawlFetch).not.toHaveBeenCalled();
  });

  it('FIRECRAWL_API_KEY missing + Cloudflare wall → listing_blocked, no Firecrawl call', async () => {
    vi.mocked(firecrawl.isFirecrawlAvailable).mockReturnValue(false);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(CLOUDFLARE_CHALLENGE_HTML, { status: 200 }),
    );
    const r = await scrapeListing('https://streeteasy.com/building/x/y');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.code).toBe('listing_blocked');
    expect(firecrawl.firecrawlFetch).not.toHaveBeenCalled();
  });

  it('Firecrawl quota exceeded → listing_blocked', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(CLOUDFLARE_CHALLENGE_HTML, { status: 200 }),
    );
    vi.mocked(firecrawl.firecrawlFetch).mockRejectedValue(
      new (firecrawl.FirecrawlError as new (
        m: string,
        s?: number,
        c?: 'quota_exceeded',
      ) => Error)('quota', 402, 'quota_exceeded'),
    );
    const r = await scrapeListing('https://streeteasy.com/building/x/y');
    expect(r.kind).toBe('error');
    if (r.kind === 'error') expect(r.code).toBe('listing_blocked');
  });

  it('strips tracking params before cache key + fetch', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(GOOD_STREETEASY_HTML, { status: 200 }),
    );
    await scrapeListing('https://streeteasy.com/building/x/y?utm_source=email&fbclid=abc');
    // The cache.getCached call should have been with the canonicalized URL
    expect(vi.mocked(cache.getCached).mock.calls[0]?.[0]).toBe(
      'https://streeteasy.com/building/x/y',
    );
  });

  it('rejects non-allowlisted hosts before any fetch (SSRF guard)', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    for (const url of [
      'http://127.0.0.1:6379/',
      'http://169.254.169.254/latest/meta-data/',
      'http://10.0.0.5:8080/admin',
      'https://attacker.example/payload',
      'file:///etc/passwd',
    ]) {
      const r = await scrapeListing(url);
      expect(r.kind).toBe('error');
      if (r.kind === 'error') expect(r.code).toBe('unsupported_url');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(firecrawl.firecrawlFetch).not.toHaveBeenCalled();
  });

  it('Zillow URL skips direct fetch entirely and goes straight to Firecrawl', async () => {
    // www.zillow.com is in ALWAYS_BOT_WALLED — direct fetch should NOT be called,
    // even before we try Firecrawl. We don't care here whether Firecrawl's HTML
    // happens to be parseable by the Zillow extractor (that's tested elsewhere);
    // we only care that the call pattern is "no direct, yes Firecrawl".
    const fetchSpy = vi.spyOn(global, 'fetch');
    vi.mocked(firecrawl.firecrawlFetch).mockResolvedValue({
      html: '<html>zillow page</html>',
      finalUrl: 'https://www.zillow.com/homedetails/123-main-st-new-york-ny-10001/12345_zpid/',
      statusCode: 200,
      costCredits: 3,
    });
    await scrapeListing(
      'https://www.zillow.com/homedetails/123-main-st-new-york-ny-10001/12345_zpid/',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(firecrawl.firecrawlFetch).toHaveBeenCalledTimes(1);
  });
});
