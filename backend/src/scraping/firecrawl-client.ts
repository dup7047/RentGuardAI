// Firecrawl REST API wrapper — replaces ScrapFly as the listing-scraping
// vendor. Used as fallback when direct fetch returns a Cloudflare challenge
// or empty HTML, and for known bot-walled hosts where direct fetch is
// guaranteed to fail (see `fetcher.ts`).
//
// Requests `formats: ["rawHtml"]` so the per-host extractors keep parsing
// the same HTML shape they did under ScrapFly. Lean request body — no
// markdown, no screenshot, no LLM extract — to keep latency tight.

import { logger } from '../logger.js';

const FIRECRAWL_BASE = 'https://api.firecrawl.dev/v2/scrape';

// Firecrawl-side timeout — they cancel their browser and return 408 fast.
const FIRECRAWL_TIMEOUT_MS = 20_000;
// Our outer AbortController — slightly higher so we get Firecrawl's 408
// response body (which carries useful context) instead of cutting them off.
const OUTER_TIMEOUT_MS = 25_000;

// Set to true the first time we see a quota_exceeded response. Stays true
// for the remainder of the process so subsequent lookups skip Firecrawl via
// `isFirecrawlAvailable()` instead of burning a request to confirm what we
// already know. Reset only by restart.
let firecrawlQuotaExhausted = false;

/** Test-only — reset the in-process quota flag between test cases. */
export function __resetFirecrawlQuotaFlag(): void {
  firecrawlQuotaExhausted = false;
}

export class FirecrawlError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: 'no_api_key' | 'quota_exceeded' | 'http_error' | 'timeout',
  ) {
    super(message);
    this.name = 'FirecrawlError';
  }
}

export type FirecrawlResult = {
  html: string;
  finalUrl: string;
  statusCode: number;
  costCredits: number;
};

/**
 * Fetch a URL through Firecrawl. Throws FirecrawlError on quota / HTTP errors.
 *
 * @param url URL to scrape
 */
export async function firecrawlFetch(url: string): Promise<FirecrawlResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new FirecrawlError('FIRECRAWL_API_KEY not set', undefined, 'no_api_key');
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OUTER_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(FIRECRAWL_BASE, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        // ONLY rawHtml — no markdown post-processing, no screenshot, no LLM extract
        formats: ['rawHtml'],
        // Firecrawl-side budget; cancels their fetch and returns 408 if exceeded
        timeout: FIRECRAWL_TIMEOUT_MS,
        // Skip ad iframes — measurably faster on listing pages
        blockAds: true,
        // Preserve <script type="application/ld+json"> blobs for the per-host
        // extractors. (Doesn't affect rawHtml output, but explicit for clarity.)
        onlyMainContent: false,
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    const code = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'http_error';
    throw new FirecrawlError(`Firecrawl request failed: ${String(e)}`, undefined, code);
  }
  clearTimeout(timer);

  // Defensively parse the JSON body — Firecrawl returns errors as JSON too.
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: {
      rawHtml?: string;
      metadata?: {
        url?: string;
        sourceURL?: string;
        statusCode?: number;
        creditsUsed?: number;
      };
    };
    error?: string;
    creditsUsed?: number;
  };

  if (!res.ok || body.success === false) {
    const errorText = body.error ?? '';
    let code: 'no_api_key' | 'quota_exceeded' | 'http_error' | 'timeout' = 'http_error';
    if (res.status === 401) {
      code = 'no_api_key';
    } else if (res.status === 402 || /insufficient|quota|credit/i.test(errorText)) {
      code = 'quota_exceeded';
    } else if (res.status === 408 || /timeout/i.test(errorText)) {
      code = 'timeout';
    }
    if (code === 'quota_exceeded') {
      firecrawlQuotaExhausted = true;
    }
    logger.warn(
      { firecrawl_status: res.status, code, error: errorText },
      'Firecrawl error',
    );
    throw new FirecrawlError(
      `Firecrawl ${res.status}: ${errorText || 'unknown'}`,
      res.status,
      code,
    );
  }

  const html = body.data?.rawHtml;
  if (typeof html !== 'string' || html.length === 0) {
    throw new FirecrawlError(
      'Firecrawl returned empty rawHtml',
      res.status,
      'http_error',
    );
  }

  return {
    html,
    finalUrl: body.data?.metadata?.sourceURL ?? body.data?.metadata?.url ?? url,
    statusCode: body.data?.metadata?.statusCode ?? res.status,
    costCredits: body.data?.metadata?.creditsUsed ?? body.creditsUsed ?? 0,
  };
}

export function isFirecrawlAvailable(): boolean {
  if (firecrawlQuotaExhausted) return false;
  return Boolean(process.env.FIRECRAWL_API_KEY && process.env.FIRECRAWL_API_KEY.length > 0);
}
