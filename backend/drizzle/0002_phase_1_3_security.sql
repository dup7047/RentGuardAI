-- Phase 1.3 security: cross-schema FKs into auth.users + RLS + policies.
--
-- The previous migration created the tables in the public schema without any
-- reference to auth.users so drizzle-kit doesn't try to manage Supabase's
-- auth schema. This migration wires the constraints by hand and turns on
-- row-level security per the policies in RENTGUARD_ROADMAP_v6 §1.3.
--
-- service_role bypasses RLS in Supabase by default (BYPASSRLS), so the
-- backend retains full read/write access without explicit policies.

-- ─── Foreign keys into auth.users ────────────────────────────────────────────

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey"
  FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "public"."building_lookups"
  ADD CONSTRAINT "building_lookups_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint

ALTER TABLE "public"."lease_reviews"
  ADD CONSTRAINT "lease_reviews_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
--> statement-breakpoint

-- ─── Row-level security: enable on every table ───────────────────────────────

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."email_lookup_counters" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."building_lookups" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "public"."lease_reviews" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ─── profiles: users can read/update their own row ──────────────────────────

CREATE POLICY "profiles_select_own"
  ON "public"."profiles" FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);
--> statement-breakpoint

CREATE POLICY "profiles_update_own"
  ON "public"."profiles" FOR UPDATE
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
--> statement-breakpoint

-- ─── email_lookup_counters: deny everything except service_role ─────────────
-- No policies = no rows visible / writable to anon or authenticated.

-- ─── building_lookups: authenticated users can read their own rows ──────────
-- Anonymous result-page reads happen via signed slugs in the backend, never
-- via PostgREST, so anon gets no policy. Inserts go through the backend
-- (service_role).

CREATE POLICY "building_lookups_select_own"
  ON "public"."building_lookups" FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
--> statement-breakpoint

-- ─── lease_reviews: authenticated users can read their own rows ─────────────
-- Anonymous post-payment reads happen via paywall_token in the backend.
-- Inserts/updates restricted to service_role.

CREATE POLICY "lease_reviews_select_own"
  ON "public"."lease_reviews" FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
