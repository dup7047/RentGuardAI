-- Allow 'firecrawl' as a valid fetch_method value alongside the existing
-- 'direct' / 'scrapfly' / 'cache'. We keep 'scrapfly' so historical rows
-- (cached during the ScrapFly era, before this vendor swap) remain valid
-- against the constraint. New writes use 'firecrawl'.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS lets re-runs no-op.

ALTER TABLE public.scraped_listings
  DROP CONSTRAINT IF EXISTS scraped_listings_fetch_method_check;

ALTER TABLE public.scraped_listings
  ADD CONSTRAINT scraped_listings_fetch_method_check
  CHECK (fetch_method IN ('direct', 'scrapfly', 'firecrawl', 'cache'));
