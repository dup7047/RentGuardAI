-- Phase 3.7b: AI cost tracking + daily aggregate function.
-- cost_alerts: rows inserted when a subject (user_id / email / anon_token)
-- exceeds the $5/30-day threshold. Service-role-only via RLS (no policies).
-- pg_cron scheduling guarded by extension-exists check so it works on
-- local Supabase (pg_cron disabled) and cloud Supabase (pg_cron enabled).

CREATE TABLE IF NOT EXISTS public.cost_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('user_id', 'email', 'anon_token')),
  subject_value text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  total_cost_cents integer NOT NULL,
  threshold_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (subject_type, subject_value, window_start, window_end)
);

ALTER TABLE public.cost_alerts ENABLE ROW LEVEL SECURITY;
-- No RLS policies: service-role connection only; anon/authenticated roles
-- have no access, which is the intent.

CREATE OR REPLACE FUNCTION public.aggregate_costs() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  threshold_cents integer := 500; -- alert at $5 cumulative over 30 days
BEGIN
  -- user_id dimension
  INSERT INTO public.cost_alerts (subject_type, subject_value, window_start, window_end, total_cost_cents, threshold_cents)
  SELECT 'user_id', user_id::text, NOW() - interval '30 days', NOW(), SUM(cost_cents), threshold_cents
  FROM public.ai_usage
  WHERE user_id IS NOT NULL AND created_at > NOW() - interval '30 days'
  GROUP BY user_id
  HAVING SUM(cost_cents) > threshold_cents
  ON CONFLICT (subject_type, subject_value, window_start, window_end) DO NOTHING;

  -- email dimension
  INSERT INTO public.cost_alerts (subject_type, subject_value, window_start, window_end, total_cost_cents, threshold_cents)
  SELECT 'email', email, NOW() - interval '30 days', NOW(), SUM(cost_cents), threshold_cents
  FROM public.ai_usage
  WHERE email IS NOT NULL AND created_at > NOW() - interval '30 days'
  GROUP BY email
  HAVING SUM(cost_cents) > threshold_cents
  ON CONFLICT (subject_type, subject_value, window_start, window_end) DO NOTHING;
END;
$$;

-- Schedule daily at 04:00 UTC only if pg_cron is available.
-- On local Supabase (pg_cron disabled) this block is a no-op.
-- On cloud Supabase (pg_cron enabled) this wires the schedule idempotently.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('rentguard-cost-aggregate', '0 4 * * *', 'SELECT public.aggregate_costs();');
  END IF;
END $$;
