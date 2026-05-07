-- Phase 3.7 follow-up: persist the new AI summary sections so the SEO
-- archive route (/v1/building/:bbl) can return them on cache hits.
--
-- Before this migration, building_lookups stored only ai_summary (text).
-- The new questions_to_ask + listing_notes sections were generated per
-- request but never saved, so cached pages returned empty arrays.
--
-- JSONB makes future shape changes cheap (no further migrations to add a
-- field; just write through). The CHECK constraints ensure they're always
-- arrays — null is allowed for backfill compatibility.

ALTER TABLE public.building_lookups
  ADD COLUMN IF NOT EXISTS ai_questions jsonb,
  ADD COLUMN IF NOT EXISTS ai_listing_notes jsonb;

ALTER TABLE public.building_lookups
  DROP CONSTRAINT IF EXISTS ai_questions_is_array,
  ADD CONSTRAINT ai_questions_is_array
    CHECK (ai_questions IS NULL OR jsonb_typeof(ai_questions) = 'array');

ALTER TABLE public.building_lookups
  DROP CONSTRAINT IF EXISTS ai_listing_notes_is_array,
  ADD CONSTRAINT ai_listing_notes_is_array
    CHECK (ai_listing_notes IS NULL OR jsonb_typeof(ai_listing_notes) = 'array');
