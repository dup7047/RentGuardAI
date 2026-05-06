-- Phase 1.5 security migration (hand-written, --custom)
-- Adds auth.users FKs that Drizzle cannot manage (cross-schema),
-- inter-table FKs, RLS, and row-level policies for the billing tables.

-- ─── Foreign keys ─────────────────────────────────────────────────────────────

-- subscriptions.user_id → auth.users(id) ON DELETE CASCADE
-- (removing a user removes their subscription rows)
ALTER TABLE subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- refunds.user_id → auth.users(id) ON DELETE SET NULL
-- (refund rows are retained 7 years per Privacy Policy §6.1; user_id is nulled)
ALTER TABLE refunds
  ADD CONSTRAINT refunds_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

-- refunds.lease_review_id → lease_reviews(id) ON DELETE SET NULL
-- (retain the refund record even if the review row is later purged)
ALTER TABLE refunds
  ADD CONSTRAINT refunds_lease_review_id_fkey
  FOREIGN KEY (lease_review_id) REFERENCES lease_reviews(id) ON DELETE SET NULL;

-- refunds.subscription_id → subscriptions(id) ON DELETE SET NULL
-- (retain the refund record even if the subscription row is later deleted)
ALTER TABLE refunds
  ADD CONSTRAINT refunds_subscription_id_fkey
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE SET NULL;

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE subscriptions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE affiliate_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage         ENABLE ROW LEVEL SECURITY;
ALTER TABLE non_nyc_waitlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds           ENABLE ROW LEVEL SECURITY;

-- subscriptions: authenticated users can read their own row only.
-- Service role (BYPASSRLS) handles all writes via the Stripe webhook handler.
CREATE POLICY "subscriptions_select_own"
  ON subscriptions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- affiliate_clicks, ai_usage, non_nyc_waitlist, refunds: service role only.
-- No policies are created — all operations require BYPASSRLS.
