-- Phase: persistent rate-limit counters
-- Replaces the in-memory Map in middleware/rate-limit.ts. The Map reset on
-- every restart and was per-process (multi-instance deploys could bypass it
-- by round-robin). Storing counters in Postgres makes the rate limit
-- multi-process safe and survives restarts.
--
-- Fixed-window design: each hour (UTC, truncated) gets its own row per
-- (route_name, subject) key. UPSERT on entry increments the count and
-- returns the new value; if it exceeds the per-route limit, the middleware
-- returns 429. Old buckets are pruned probabilistically by the middleware
-- itself (no separate cron required) but a periodic cleanup is also safe.

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  key           TEXT        NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_start)
);

-- Lets the cleanup query (DELETE WHERE window_start < ...) avoid a full scan.
CREATE INDEX IF NOT EXISTS idx_rate_limit_counters_window_start
  ON rate_limit_counters (window_start);
