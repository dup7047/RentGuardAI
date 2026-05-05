-- Phase 1.4 security: cache-table RLS + the deferred building_lookups FK.
--
-- buildings + landlords are public reference data sourced from NYC Open Data.
-- Per RENTGUARD_ROADMAP_v6 §1.4: read-only public access; writes restricted
-- to service_role (which bypasses RLS via BYPASSRLS). The roadmap §1.3 also
-- declares building_lookups.building_bbl as an FK; with buildings now in
-- existence we can wire the constraint here.

-- ─── building_lookups.building_bbl FK (deferred from Phase 1.3) ─────────────

ALTER TABLE "public"."building_lookups"
  ADD CONSTRAINT "building_lookups_building_bbl_fkey"
  FOREIGN KEY ("building_bbl") REFERENCES "public"."buildings"("bbl") ON DELETE SET NULL;
--> statement-breakpoint

-- ─── RLS: enable on both cache tables ───────────────────────────────────────

ALTER TABLE "public"."buildings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."landlords" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ─── Public read, no client-side write ──────────────────────────────────────
-- SELECT-only policies for anon + authenticated; absence of any
-- INSERT/UPDATE/DELETE policy means non-service-role clients are denied
-- on writes. service_role bypasses RLS so the backend can hydrate the cache.

CREATE POLICY "buildings_select_public"
  ON "public"."buildings" FOR SELECT
  TO anon, authenticated
  USING (true);
--> statement-breakpoint

CREATE POLICY "landlords_select_public"
  ON "public"."landlords" FOR SELECT
  TO anon, authenticated
  USING (true);
