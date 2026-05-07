-- Phase: search performance.
--
-- Two partial indexes that match the exact predicates of the hot queries
-- on building_lookups. Both are non-blocking — Postgres builds them
-- without locking out writes.
--
-- 1. countAnonLookups (src/lib/counters.ts:16-22) runs COUNT(*) filtered
--    by anon_token + email IS NULL on every anonymous request, before any
--    data fetch. Without this index it's a sequential scan that grows
--    linearly with table size.
--
-- 2. findRecentLookup (src/routes/lookup.ts:79-104) selects the most
--    recent address-only lookup row for a BBL within the AI cache TTL.
--    The WHERE clause filters out URL-based rows (aiScrapedListing IS NULL)
--    and incomplete rows; the partial index lets Postgres use an index-only
--    scan.

CREATE INDEX IF NOT EXISTS idx_building_lookups_anon_token
  ON public.building_lookups (anon_token)
  WHERE email IS NULL;

CREATE INDEX IF NOT EXISTS idx_building_lookups_cache_hit
  ON public.building_lookups (building_bbl, created_at DESC)
  WHERE ai_summary IS NOT NULL
    AND ai_score IS NOT NULL
    AND ai_score_band IS NOT NULL
    AND ai_scraped_listing IS NULL;
