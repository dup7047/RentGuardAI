-- Phase 4: persistent cache for scraped NYC rental listings.
--
-- Keyed by canonical URL (tracking params stripped). 7-day read TTL is
-- enforced in code, not SQL — older rows get re-fetched on next request.
-- raw_html_gz is debug-only and dropped at 7d by a future cron pass.
-- data jsonb holds the parsed ScrapedListing union.

CREATE TABLE IF NOT EXISTS public.scraped_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  url text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('streeteasy', 'zillow', 'generic')),
  source_kind text,
  fetched_at timestamptz NOT NULL DEFAULT NOW(),
  fetch_method text NOT NULL CHECK (fetch_method IN ('direct', 'scrapfly', 'cache')),
  fetch_cost_credits integer DEFAULT 0,
  raw_html_gz bytea,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scraped_listings_fetched_at
  ON public.scraped_listings (fetched_at);

ALTER TABLE public.scraped_listings ENABLE ROW LEVEL SECURITY;
-- No RLS policies → service-role-only. Anon and authenticated roles cannot
-- read/write directly; they only see scraped data through the /v1/lookup
-- response or the SEO archive route.
