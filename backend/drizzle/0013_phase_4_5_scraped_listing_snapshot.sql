-- Phase 4.5 follow-up: snapshot the scraped listing data onto each lookup so
-- the SEO archive route (/v1/building/:bbl) can return it on cache hits.
--
-- The scraped_listings table is keyed by URL — there's no clean join from
-- (bbl) → (url) because a building can have many listings over time. So we
-- store a per-lookup snapshot of the structured data here. Yes, it's
-- denormalized, but it's a tiny JSONB blob and the alternative is double-
-- fetching every page render.

ALTER TABLE public.building_lookups
  ADD COLUMN IF NOT EXISTS ai_scraped_listing jsonb;
