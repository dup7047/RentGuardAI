-- Persist per-apartment risk callouts alongside the AI summary so cache hits
-- return the full at_risk_apartments array without re-running the AI.
-- Nullable: rows written before this migration return NULL, which the route
-- maps to [] — forward-compatible with no data migration needed.

ALTER TABLE public.building_lookups
  ADD COLUMN IF NOT EXISTS ai_at_risk_apartments jsonb;

ALTER TABLE public.building_lookups
  DROP CONSTRAINT IF EXISTS ai_at_risk_apartments_is_array,
  ADD CONSTRAINT ai_at_risk_apartments_is_array
    CHECK (ai_at_risk_apartments IS NULL OR jsonb_typeof(ai_at_risk_apartments) = 'array');
