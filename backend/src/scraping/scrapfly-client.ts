// ScrapFly REST API wrapper.
// Used as fallback when direct fetch returns a Cloudflare challenge or empty
// HTML. ASP (anti-scraping protection) + JS render handle StreetEasy + Zillow.
// Free tier: 1000 fetches/mo. We track credit cost per call for ops review.

import { logger } from '../logger.js';

const SCRAPFLY_BASE = 'https://api.scrapfly.io/scrape';
const TIMEOUT_MS = 35_000;

export class ScrapflyError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: 'no_api_key' | 'quota_exceeded' | 'http_error' | 'timeout',
  ) {
    super(message);
    this.name = 'ScrapflyError';
  }
}

export type ScrapflyResult = {
  html: string;
  finalUrl: string;
  statusCode: number;
  costCredits: number;
};

/**
 * Fetch a URL through ScrapFly. Throws ScrapflyError on quota / HTTP errors.
 *
 * @param url URL to scrape
 * @param opts.asp Enable anti-scraping protection (Cloudflare bypass). Default true.
 * @param opts.renderJs Render with headless browser. Default true.
 */
export async function scrapflyFetch(
  url: string,
  opts: { asp?: boolean; renderJs?: boolean } = {},
): Promise<ScrapflyResult> {
  const apiKey = process.env.SCRAPFLY_API_KEY;
  if (!apiKey) {
    throw new ScrapflyError('SCRAPFLY_API_KEY not set', undefined, 'no_api_key');
  }

  const params = new URLSearchParams({
    key: apiKey,
    url,
    asp: String(opts.asp ?? true),
    render_js: String(opts.renderJs ?? true),
    country: 'us',
  });
  const requestUrl = `${SCRAPFLY_BASE}?${params.toString()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(requestUrl, { signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    const code = e instanceof Error && e.name === 'AbortError' ? 'timeout' : 'http_error';
    throw new ScrapflyError(`ScrapFly request failed: ${String(e)}`, undefined, code);
  }
  clearTimeout(timer);

  // ScrapFly returns 422 with `code: ERR::SCRAPE::QUOTA_EXCEEDED` when free tier is out.
  // Other non-2xx are unexpected.
  const body = (await res.json().catch(() => ({}))) as {
    result?: { content?: string; status_code?: number; url?: string };
    context?: { cost?: number };
    code?: string;
    message?: string;
  };
  if (!res.ok) {
    const code = body.code === 'ERR::SCRAPE::QUOTA_EXCEEDED' ? 'quota_exceeded' : 'http_error';
    logger.warn(
      { scrapfly_status: res.status, code: body.code, message: body.message },
      'ScrapFly error',
    );
    throw new ScrapflyError(
      `ScrapFly ${res.status} (${body.code ?? 'unknown'}): ${body.message ?? ''}`,
      res.status,
      code,
    );
  }
  const html = body.result?.content;
  if (typeof html !== 'string' || html.length === 0) {
    throw new ScrapflyError('ScrapFly returned empty content', res.status, 'http_error');
  }

  return {
    html,
    finalUrl: body.result?.url ?? url,
    statusCode: body.result?.status_code ?? res.status,
    costCredits: body.context?.cost ?? 0,
  };
}

export function isScrapflyAvailable(): boolean {
  return Boolean(process.env.SCRAPFLY_API_KEY && process.env.SCRAPFLY_API_KEY.length > 0);
}
