-- Per-user "saved buildings" list. A user (profile) can save any BBL they've
-- looked up; the dashboard renders this list on /dashboard.
--
-- ON DELETE CASCADE on user_id ties cleanup to the existing
-- profiles.deletionRequestedAt flow — when a user's profile row is deleted,
-- their saved rows go too.
--
-- Idempotent: IF NOT EXISTS clauses make re-runs no-ops.

CREATE TABLE IF NOT EXISTS public.saved_buildings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  bbl text NOT NULL,
  -- Reserved for a future "add a note" UX. Null for v1.
  note text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  -- A user can only save a given BBL once. Lets us upsert idempotently
  -- with ON CONFLICT (user_id, bbl) DO NOTHING.
  UNIQUE (user_id, bbl)
);

-- Covers the dashboard list query: WHERE user_id = $1 ORDER BY created_at DESC.
CREATE INDEX IF NOT EXISTS idx_saved_buildings_user_created
  ON public.saved_buildings (user_id, created_at DESC);

ALTER TABLE public.saved_buildings ENABLE ROW LEVEL SECURITY;
-- No RLS policies → service-role-only. Anon and authenticated roles cannot
-- read/write directly; they only interact via /v1/saved-buildings, which
-- enforces user_id scoping in code.
