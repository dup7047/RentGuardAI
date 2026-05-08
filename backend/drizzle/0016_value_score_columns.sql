-- Phase: Apartment Value Score columns on building_lookups
-- Adds value score persistence alongside the existing maintenance score columns.
-- All nullable so existing rows are unaffected.

ALTER TABLE building_lookups
  ADD COLUMN IF NOT EXISTS ai_value_score        INTEGER,
  ADD COLUMN IF NOT EXISTS ai_value_band         TEXT,
  ADD COLUMN IF NOT EXISTS ai_value_confidence   TEXT,
  ADD COLUMN IF NOT EXISTS ai_value_factors      JSONB,
  ADD COLUMN IF NOT EXISTS ai_value_explanation  TEXT;

-- Partial index: fast lookup of rows that have a value score, used by the
-- SEO archive route to hydrate value data without a full table scan.
CREATE INDEX IF NOT EXISTS idx_building_lookups_value_score
  ON building_lookups (building_bbl, created_at DESC)
  WHERE ai_value_score IS NOT NULL;
