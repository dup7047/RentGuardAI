-- Phase 1.2 baseline migration.
--
-- Application tables land in Phase 1.3. This file exists only to prove the
-- Drizzle migration toolchain runs end-to-end. The single statement is
-- idempotent and Supabase ships with pgcrypto already enabled, so applying
-- this against a fresh or existing Supabase Postgres is a no-op either way.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
