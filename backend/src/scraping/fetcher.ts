// Listing fetcher — the entry point used by /v1/lookup.
//   1. Canonicalize URL
//   2. Cache check (7-day TTL)
//   3. Direct fetch with browser-like headers
//   4. If blocked / empty / suspicious → ScrapFly fallback (if key set)
//   5. Run per-host extractor on whichever HTML we got
//   6. Cache the parsed result

import { logger } from '../logger.js';
import { canonicalizeListingUrl, detectListingHost } from './url-canonicalize.js';
import { getCached, setCached } from './cache.js';
import { scrapflyFetch, ScrapflyError, isScrapflyAvailable } from './scrapfly-client.js';
import { extractStreetEasy } from './extractors/streeteasy.js';
import { extractZillow } from './extractors/zillow.js';
import { extractGeneric } from './extractors/generic.js';
import type { ScrapeResult, ListingSource } from './types.js';

const DIRECT_TIMEOUT_MS = 10_000;
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  // Some sites 403 on missing Referer; using google as a benign default
  Referer: 'https://www.google.com/',
};

/**
 * Heuristic for "did the direct fetch actually return real content or a wall?"
 * — Cloudflare challenge pages are tiny and contain "Just a moment..." or
 *   "Verifying you are human" or "cf-mitigated"
 * - DataDome / PerimeterX walls have similar tells
 * - Empty bodies + 403 status are walls
 */
function looksBlocked(html: string, status: number): boolean {
  if (status === 403 || status === 503) return true;
  if (html.length < 2000) return true;
  const lower = html.toLowerCase();
  if (lower.includes('just a moment')) return true;
  if (lower.includes('verifying you are human')) return true;
  if (lower.includes('cf-mitigated')) return true;
  if (lower.includes('access denied') && lower.length < 5000) return true;
  if (lower.includes('captcha-delivery.com')) return true; // DataDome
  return false;
}

function pickExtractor(source: ListingSource) {
  if (source === 'streeteasy') return extractStreetEasy;
  if (source === 'zillow') return extractZillow;
  return extractGeneric;
}

/**
 * Main entry point. Returns a `ScrapeResult` discriminated union.
 */
export async function scrapeListing(rawUrl: string): Promise<ScrapeResult> {
  const canonicalUrl = canonicalizeListingUrl(rawUrl);
  const detect = detectListingHost(canonicalUrl);
  if (!detect) {
    return { kind: 'error', code: 'unsupported_url' };
  }

  // 1. Cache hit?
  try {
    const cached = await getCached(canonicalUrl);
    if (cached) {
      logger.info({ url: canonicalUrl, fetch_method: 'cache' }, 'listing scrape cache hit');
      return { kind: 'ok', data: cached.data, fetchMethod: 'cache' };
    }
  } catch (e) {
    logger.warn({ err: String(e) }, 'cache read failed; continuing with fresh fetch');
  }

  const source = detect.source;
  const extractor = pickExtractor(source);

  // 2. Direct fetch
  let html: string | null = null;
  let directStatus = 0;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), DIRECT_TIMEOUT_MS);
    const res = await fetch(canonicalUrl, { headers: BROWSER_HEADERS, signal: ctrl.signal });
    clearTimeout(timer);
    directStatus = res.status;
    if (res.status === 404) {
      return { kind: 'error', code: 'listing_not_found', status: 404 };
    }
    if (res.ok) {
      html = await res.text();
    }
  } catch (e) {
    logger.warn({ url: canonicalUrl, err: String(e) }, 'direct fetch failed; will try ScrapFly');
  }

  // 3. Try direct extraction if HTML looks usable
  if (html && !looksBlocked(html, directStatus)) {
    const extracted = extractor(html, canonicalUrl);
    if (extracted) {
      await safeSetCached({ canonicalUrl, data: extracted, fetchMethod: 'direct', rawHtml: html });
      return { kind: 'ok', data: extracted, fetchMethod: 'direct' };
    }
  }

  // 4. ScrapFly fallback — only if direct didn't work AND key is configured
  if (!isScrapflyAvailable()) {
    logger.info(
      { url: canonicalUrl, direct_status: directStatus, html_len: html?.length ?? 0 },
      'direct fetch insufficient and SCRAPFLY_API_KEY not set',
    );
    return { kind: 'error', code: 'listing_blocked', status: directStatus || undefined };
  }

  let scrapflyHtml: string;
  let costCredits = 0;
  try {
    const sf = await scrapflyFetch(canonicalUrl, { asp: true, renderJs: true });
    scrapflyHtml = sf.html;
    costCredits = sf.costCredits;
    if (sf.statusCode === 404) {
      return { kind: 'error', code: 'listing_not_found', status: 404 };
    }
  } catch (e) {
    if (e instanceof ScrapflyError && e.code === 'quota_exceeded') {
      logger.error('ScrapFly quota exceeded — fallback unavailable until next cycle');
      return { kind: 'error', code: 'listing_blocked', message: 'scrapfly_quota_exceeded' };
    }
    logger.warn({ url: canonicalUrl, err: String(e) }, 'ScrapFly fetch failed');
    return { kind: 'error', code: 'listing_blocked', message: String(e) };
  }

  const extracted = extractor(scrapflyHtml, canonicalUrl);
  if (!extracted) {
    return { kind: 'error', code: 'listing_blocked', message: 'extractor_returned_null' };
  }

  await safeSetCached({
    canonicalUrl,
    data: extracted,
    fetchMethod: 'scrapfly',
    rawHtml: scrapflyHtml,
    fetchCostCredits: costCredits,
  });
  return { kind: 'ok', data: extracted, fetchMethod: 'scrapfly' };
}

async function safeSetCached(args: Parameters<typeof setCached>[0]): Promise<void> {
  try {
    await setCached(args);
  } catch (e) {
    // Cache write failure shouldn't block the response — the caller already has data
    logger.warn({ err: String(e), url: args.canonicalUrl }, 'cache write failed');
  }
}

// Re-export for convenience
export { canonicalizeListingUrl } from './url-canonicalize.js';
export type { ScrapedListing, ScrapeResult } from './types.js';
