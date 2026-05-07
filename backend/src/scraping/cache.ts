// Read-through cache for scraped listings.
// 7-day TTL on the parsed `data` jsonb. raw_html_gz is also stored (for ≤7d
// debug) but a separate cron prune (out of scope) drops it after 7d.

import { getPool } from '../db/client.js';
import { gzipSync } from 'node:zlib';
import type { ScrapedListing } from './types.js';

const TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CachedListing = {
  data: ScrapedListing;
  fetched_at: string;
  fetch_method: 'direct' | 'scrapfly' | 'cache';
};

/**
 * Read a cached listing if fresh (within TTL). Returns null on miss or stale.
 */
export async function getCached(canonicalUrl: string): Promise<CachedListing | null> {
  const pool = getPool();
  const r = await pool.query<{
    data: ScrapedListing;
    fetched_at: Date;
    fetch_method: 'direct' | 'scrapfly' | 'cache';
  }>(
    `SELECT data, fetched_at, fetch_method
     FROM public.scraped_listings
     WHERE url = $1
     LIMIT 1`,
    [canonicalUrl],
  );
  const row = r.rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.fetched_at).getTime() > TTL_MS) return null;
  return {
    data: row.data,
    fetched_at: row.fetched_at.toISOString(),
    fetch_method: row.fetch_method,
  };
}

/**
 * Write a fresh scrape to cache. Upserts on conflict — stale rows get replaced.
 */
export async function setCached(args: {
  canonicalUrl: string;
  data: ScrapedListing;
  fetchMethod: 'direct' | 'scrapfly';
  rawHtml?: string;
  fetchCostCredits?: number;
}): Promise<void> {
  const { canonicalUrl, data, fetchMethod, rawHtml, fetchCostCredits = 0 } = args;
  const pool = getPool();
  const rawHtmlGz = rawHtml ? gzipSync(Buffer.from(rawHtml, 'utf8')) : null;

  await pool.query(
    `INSERT INTO public.scraped_listings
       (url, source, source_kind, fetched_at, fetch_method, fetch_cost_credits, raw_html_gz, data)
     VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)
     ON CONFLICT (url) DO UPDATE SET
       source = EXCLUDED.source,
       source_kind = EXCLUDED.source_kind,
       fetched_at = NOW(),
       fetch_method = EXCLUDED.fetch_method,
       fetch_cost_credits = EXCLUDED.fetch_cost_credits,
       raw_html_gz = EXCLUDED.raw_html_gz,
       data = EXCLUDED.data`,
    [
      canonicalUrl,
      data.source,
      data.source_kind,
      fetchMethod,
      fetchCostCredits,
      rawHtmlGz,
      JSON.stringify(data),
    ],
  );
}
