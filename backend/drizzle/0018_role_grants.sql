-- Explicit role grants for the Supabase API roles.
--
-- Historically Supabase granted table-level privileges on the public schema
-- to anon / authenticated / service_role by default, and every migration in
-- this repo relied on that: RLS (enabled on every table, policies in the
-- *_security migrations) was the only gate. Newer Supabase CLI versions no
-- longer ship those default grants in fresh local stacks, so `supabase start`
-- + migrate left anon/authenticated with no table ACLs at all — queries died
-- with 42501 "permission denied" before RLS was ever evaluated, breaking the
-- RLS integration suites in CI.
--
-- This migration makes the intended model explicit and reproducible:
--   * table/sequence access is granted at the ACL level,
--   * row visibility remains governed entirely by RLS policies.
-- It is idempotent and a no-op on databases (like production) that already
-- carry the legacy default grants.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public
  TO anon, authenticated, service_role;
--> statement-breakpoint

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public
  TO anon, authenticated, service_role;
--> statement-breakpoint

-- Cover tables/sequences created by FUTURE migrations (which run as the same
-- role executing this one), so a new table can't silently ship without ACLs.

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO anon, authenticated, service_role;
--> statement-breakpoint

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated, service_role;
