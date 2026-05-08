-- Phase: Apartment Value Score columns on building_lookups
-- Adds value score persistence alongside the existing maintenance score columns.
-- All nullable so existing rows are unaffected.
--
-- NOTE: this intentionally repeats the idempotent SQL from the unjournaled
-- 0016_value_score_columns.sql file. Drizzle only runs migrations listed in
-- meta/_journal.json; because that file was not journaled, production never
-- created these columns.

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
