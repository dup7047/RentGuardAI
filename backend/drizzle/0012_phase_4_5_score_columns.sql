-- Phase 4.5: persist deterministic score + AI-narrated sections so the SEO
-- archive route can return them on cache hits without re-running the AI.
--
-- Score is recomputable from the snapshotted record counts at lookup time,
-- but persisting it freezes the verdict at a point in time and avoids ever
-- showing a different score for the same lookup_id.

ALTER TABLE public.building_lookups
  ADD COLUMN IF NOT EXISTS ai_listing_summary text,
  ADD COLUMN IF NOT EXISTS ai_score_explanation text,
  ADD COLUMN IF NOT EXISTS ai_score integer,
  ADD COLUMN IF NOT EXISTS ai_score_band text,
  ADD COLUMN IF NOT EXISTS ai_score_factors jsonb;

ALTER TABLE public.building_lookups
  DROP CONSTRAINT IF EXISTS ai_score_range,
  ADD CONSTRAINT ai_score_range
    CHECK (ai_score IS NULL OR (ai_score >= 0 AND ai_score <= 100));

ALTER TABLE public.building_lookups
  DROP CONSTRAINT IF EXISTS ai_score_band_valid,
  ADD CONSTRAINT ai_score_band_valid
    CHECK (ai_score_band IS NULL OR ai_score_band IN ('minimal', 'moderate', 'elevated', 'high'));

ALTER TABLE public.building_lookups
  DROP CONSTRAINT IF EXISTS ai_score_factors_is_array,
  ADD CONSTRAINT ai_score_factors_is_array
    CHECK (ai_score_factors IS NULL OR jsonb_typeof(ai_score_factors) = 'array');
