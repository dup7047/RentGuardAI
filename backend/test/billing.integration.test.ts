import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0;
const describeIfDb = RUN ? describe : describe.skip;

// Helper: run SQL under a specific Postgres role (RLS enforcement).
// Always rolled back so tests leave no permanent state.
async function asRole<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  role: 'anon' | 'authenticated',
  userId: string | null,
  sql: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role, sub: userId ?? undefined }),
    ]);
    return await client.query<T>(sql, params);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

// Create a real auth.users row so FK constraints are satisfiable.
async function createAuthUser(pool: pg.Pool): Promise<string> {
  const { rows: [row] } = await pool.query<{ id: string }>(
    `INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, aud, role)
       VALUES (gen_random_uuid(), $1, '', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
       RETURNING id`,
    [`test-billing-${Date.now()}@rentguard.test`]
  );
  return row!.id;
}

describeIfDb('Phase 1.5 billing tables (integration — local Supabase)', () => {
  let pool: pg.Pool;
  let userId: string;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    userId = await createAuthUser(pool);
  });

  afterAll(async () => {
    // Cascade deletes subscriptions; SET NULLs refunds.user_id automatically.
    await pool.query('DELETE FROM auth.users WHERE id = $1', [userId]);
    await pool.query("DELETE FROM public.non_nyc_waitlist WHERE email LIKE 'test-billing-%@rentguard.test'");
    await pool.query("DELETE FROM public.ai_usage WHERE model_used = 'test-model'");
    await pool.query("DELETE FROM public.affiliate_clicks WHERE referrer_url LIKE '%rentguard.test%'");
    await pool.query("DELETE FROM public.refunds WHERE stripe_refund_id LIKE 're_test_%'");
    await pool.end();
  });

  // ─── Schema shape ─────────────────────────────────────────────────────────

  describe('schema shape', () => {
    it('creates all 5 billing tables with RLS enabled', async () => {
      const { rows } = await pool.query<{ tablename: string; rowsecurity: boolean }>(
        `SELECT tablename, rowsecurity FROM pg_tables
           WHERE schemaname = 'public'
             AND tablename IN ('subscriptions','affiliate_clicks','ai_usage','non_nyc_waitlist','refunds')
           ORDER BY tablename`
      );
      expect(rows).toEqual([
        { tablename: 'affiliate_clicks', rowsecurity: true },
        { tablename: 'ai_usage', rowsecurity: true },
        { tablename: 'non_nyc_waitlist', rowsecurity: true },
        { tablename: 'refunds', rowsecurity: true },
        { tablename: 'subscriptions', rowsecurity: true },
      ]);
    });

    it('creates exactly one policy on subscriptions (own-row SELECT)', async () => {
      const { rows } = await pool.query<{
        policyname: string;
        tablename: string;
        cmd: string;
        role_list: string;
      }>(
        `SELECT policyname, tablename, cmd, array_to_string(roles, ',') AS role_list
           FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('subscriptions','affiliate_clicks','ai_usage','non_nyc_waitlist','refunds')
           ORDER BY tablename, policyname`
      );
      expect(rows).toEqual([
        {
          policyname: 'subscriptions_select_own',
          tablename: 'subscriptions',
          cmd: 'SELECT',
          role_list: 'authenticated',
        },
      ]);
    });

    it('wires subscriptions.user_id → auth.users(id) ON DELETE CASCADE', async () => {
      const { rows } = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
           WHERE conname = 'subscriptions_user_id_fkey'`
      );
      expect(rows[0]?.def).toMatch(
        /FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE CASCADE/i
      );
    });

    it('wires refunds.user_id → auth.users(id) ON DELETE SET NULL', async () => {
      const { rows } = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
           WHERE conname = 'refunds_user_id_fkey'`
      );
      expect(rows[0]?.def).toMatch(
        /FOREIGN KEY \(user_id\) REFERENCES auth\.users\(id\) ON DELETE SET NULL/i
      );
    });

    it('wires refunds.lease_review_id → lease_reviews(id) ON DELETE SET NULL', async () => {
      const { rows } = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
           WHERE conname = 'refunds_lease_review_id_fkey'`
      );
      expect(rows[0]?.def).toMatch(
        /FOREIGN KEY \(lease_review_id\) REFERENCES lease_reviews\(id\) ON DELETE SET NULL/i
      );
    });
  });

  // ─── Acceptance: affiliate click / click-through / conversion ─────────────

  describe('affiliate_clicks lifecycle (service-role write path)', () => {
    beforeEach(async () => {
      await pool.query(
        "DELETE FROM public.affiliate_clicks WHERE referrer_url LIKE '%rentguard.test%'"
      );
    });

    it('records a modal click (clicked_modal_at set, clicked_through_at null)', async () => {
      const { rows: [row] } = await pool.query<{ id: string; clicked_through_at: Date | null }>(
        `INSERT INTO public.affiliate_clicks
           (user_id, partner, referrer_url, clicked_modal_at)
         VALUES ($1, 'lemonade', 'https://rentguard.test/lookup', now())
         RETURNING id, clicked_through_at`,
        [userId]
      );
      expect(row?.id).toBeTruthy();
      expect(row?.clicked_through_at).toBeNull();
    });

    it('records the click-through by setting clicked_through_at', async () => {
      // insert
      const { rows: [ins] } = await pool.query<{ id: string }>(
        `INSERT INTO public.affiliate_clicks
           (user_id, partner, referrer_url, clicked_modal_at)
         VALUES ($1, 'bellhop', 'https://rentguard.test/lookup', now())
         RETURNING id`,
        [userId]
      );
      const id = ins!.id;
      // update
      await pool.query(
        `UPDATE public.affiliate_clicks SET clicked_through_at = now() WHERE id = $1`,
        [id]
      );
      const { rows } = await pool.query<{ clicked_through_at: Date | null }>(
        'SELECT clicked_through_at FROM public.affiliate_clicks WHERE id = $1',
        [id]
      );
      expect(rows[0]?.clicked_through_at).toBeInstanceOf(Date);
    });

    it('records conversion with commission amount', async () => {
      const { rows: [ins] } = await pool.query<{ id: string }>(
        `INSERT INTO public.affiliate_clicks
           (anon_token, partner, referrer_url, clicked_modal_at, clicked_through_at)
         VALUES (gen_random_uuid(), 'moved', 'https://rentguard.test/lookup', now(), now())
         RETURNING id`,
        []
      );
      const id = ins!.id;
      await pool.query(
        `UPDATE public.affiliate_clicks
           SET converted_at = now(), commission_amount_cents = $1
         WHERE id = $2`,
        [2550, id]
      );
      const { rows } = await pool.query<{
        converted_at: Date | null;
        commission_amount_cents: number | null;
      }>(
        'SELECT converted_at, commission_amount_cents FROM public.affiliate_clicks WHERE id = $1',
        [id]
      );
      expect(rows[0]?.converted_at).toBeInstanceOf(Date);
      expect(rows[0]?.commission_amount_cents).toBe(2550);
    });
  });

  // ─── Acceptance: ai_usage row per model call ───────────────────────────────

  describe('ai_usage (service-role write path)', () => {
    it('writes a usage row for a lookup call', async () => {
      const { rows: [row] } = await pool.query<{
        route: string;
        cost_cents: number;
        model_used: string;
      }>(
        `INSERT INTO public.ai_usage (user_id, route, cost_cents, model_used)
           VALUES ($1, 'lookup', 14, 'test-model')
           RETURNING route, cost_cents, model_used`,
        [userId]
      );
      expect(row?.route).toBe('lookup');
      expect(row?.cost_cents).toBe(14);
      expect(row?.model_used).toBe('test-model');
    });

    it('writes a usage row with null user_id for anonymous callers', async () => {
      const { rows: [row] } = await pool.query<{ user_id: string | null }>(
        `INSERT INTO public.ai_usage (email, route, cost_cents, model_used)
           VALUES ('anon@rentguard.test', 'lease_preview', 28, 'test-model')
           RETURNING user_id`,
        []
      );
      expect(row?.user_id).toBeNull();
    });
  });

  // ─── Acceptance: non_nyc_waitlist ──────────────────────────────────────────

  describe('non_nyc_waitlist (service-role write path)', () => {
    it('captures email + attempted city + state for a non-NYC paste', async () => {
      const { rows: [row] } = await pool.query<{
        email: string;
        attempted_address: string;
        requested_city: string;
        requested_state: string;
      }>(
        `INSERT INTO public.non_nyc_waitlist
           (email, attempted_address, requested_city, requested_state)
         VALUES ($1, $2, $3, $4)
         RETURNING email, attempted_address, requested_city, requested_state`,
        ['test-billing-waitlist@rentguard.test', '1600 Pennsylvania Ave', 'Washington', 'DC']
      );
      expect(row?.email).toBe('test-billing-waitlist@rentguard.test');
      expect(row?.attempted_address).toBe('1600 Pennsylvania Ave');
      expect(row?.requested_city).toBe('Washington');
      expect(row?.requested_state).toBe('DC');
    });
  });

  // ─── Acceptance: refunds — writeable + survives account deletion ──────────

  describe('refunds lifecycle (service-role write path)', () => {
    it('writes a refund row linked to a subscription', async () => {
      // Create subscription first
      const { rows: [sub] } = await pool.query<{ id: string }>(
        `INSERT INTO public.subscriptions
           (user_id, stripe_subscription_id, status, current_period_end)
         VALUES ($1, 'sub_test_billing_001', 'active', now() + interval '30 days')
         RETURNING id`,
        [userId]
      );
      const subId = sub!.id;

      const { rows: [refund] } = await pool.query<{
        id: string;
        amount_cents: number;
        eligibility_reason: string;
      }>(
        `INSERT INTO public.refunds
           (user_id, subscription_id, stripe_refund_id, amount_cents, eligibility_reason)
         VALUES ($1, $2, 're_test_sub_001', 1499, 'cancellation within 24h')
         RETURNING id, amount_cents, eligibility_reason`,
        [userId, subId]
      );
      expect(refund?.amount_cents).toBe(1499);
      expect(refund?.eligibility_reason).toBe('cancellation within 24h');

      // Cleanup
      await pool.query('DELETE FROM public.refunds WHERE id = $1', [refund!.id]);
      await pool.query('DELETE FROM public.subscriptions WHERE id = $1', [subId]);
    });

    it('user_id is SET NULL on refund when auth.users row is deleted', async () => {
      const tempUser = await createAuthUser(pool);

      const { rows: [refund] } = await pool.query<{ id: string }>(
        `INSERT INTO public.refunds
           (user_id, stripe_refund_id, amount_cents, eligibility_reason)
         VALUES ($1, 're_test_cascade_001', 2900, 'preview-only refund test')
         RETURNING id`,
        [tempUser]
      );
      const refundId = refund!.id;

      // Delete the auth user — refund.user_id should become NULL
      await pool.query('DELETE FROM auth.users WHERE id = $1', [tempUser]);

      const { rows } = await pool.query<{ user_id: string | null }>(
        'SELECT user_id FROM public.refunds WHERE id = $1',
        [refundId]
      );
      expect(rows[0]?.user_id).toBeNull();

      await pool.query('DELETE FROM public.refunds WHERE id = $1', [refundId]);
    });
  });

  // ─── Acceptance: subscriptions FK cascade on user deletion ────────────────

  describe('subscriptions — CASCADE on auth.users deletion', () => {
    it('deletes subscription rows when the auth user is deleted', async () => {
      const tempUser = await createAuthUser(pool);

      await pool.query(
        `INSERT INTO public.subscriptions
           (user_id, stripe_subscription_id, status, current_period_end)
         VALUES ($1, 'sub_test_cascade_001', 'active', now() + interval '30 days')`,
        [tempUser]
      );

      // Verify row exists
      const before = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.subscriptions WHERE user_id = $1",
        [tempUser]
      );
      expect(Number(before.rows[0]?.count)).toBe(1);

      // Delete user → subscription should cascade
      await pool.query('DELETE FROM auth.users WHERE id = $1', [tempUser]);

      const after = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.subscriptions WHERE user_id = $1",
        [tempUser]
      );
      expect(Number(after.rows[0]?.count)).toBe(0);
    });
  });

  // ─── RLS — subscriptions ──────────────────────────────────────────────────

  describe('RLS — subscriptions', () => {
    let subId: string;

    beforeEach(async () => {
      const { rows: [row] } = await pool.query<{ id: string }>(
        `INSERT INTO public.subscriptions
           (user_id, stripe_subscription_id, status, current_period_end)
         VALUES ($1, 'sub_rls_test_001', 'active', now() + interval '30 days')
         ON CONFLICT (stripe_subscription_id) DO UPDATE
           SET status = EXCLUDED.status
         RETURNING id`,
        [userId]
      );
      subId = row!.id;
    });

    afterEach(async () => {
      await pool.query(
        "DELETE FROM public.subscriptions WHERE stripe_subscription_id LIKE 'sub_rls_%'"
      );
    });

    it('authenticated user CANNOT read subscriptions as anon (no policy for anon)', async () => {
      const r = await asRole<{ id: string }>(
        pool,
        'anon',
        null,
        'SELECT id FROM public.subscriptions WHERE id = $1',
        [subId]
      );
      expect(r.rows).toEqual([]);
    });

    it('authenticated user CAN read their own subscription', async () => {
      const r = await asRole<{ id: string }>(
        pool,
        'authenticated',
        userId,
        'SELECT id FROM public.subscriptions WHERE id = $1',
        [subId]
      );
      expect(r.rows).toEqual([{ id: subId }]);
    });

    it('authenticated user CANNOT read another user\'s subscription', async () => {
      const otherId = '00000000-0000-0000-0000-000000000001';
      const r = await asRole<{ id: string }>(
        pool,
        'authenticated',
        otherId,
        'SELECT id FROM public.subscriptions WHERE id = $1',
        [subId]
      );
      expect(r.rows).toEqual([]);
    });

    it('anon CANNOT INSERT a subscription row', async () => {
      await expect(
        asRole(
          pool,
          'anon',
          null,
          `INSERT INTO public.subscriptions
             (user_id, stripe_subscription_id, status, current_period_end)
           VALUES ($1, 'sub_anon_inject', 'active', now() + interval '30 days')`,
          [userId]
        )
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  // ─── RLS — service-role-only tables ───────────────────────────────────────

  describe('RLS — affiliate_clicks, ai_usage, non_nyc_waitlist, refunds (service role only)', () => {
    it('anon CANNOT SELECT from affiliate_clicks', async () => {
      const r = await asRole<{ id: string }>(
        pool,
        'anon',
        null,
        'SELECT id FROM public.affiliate_clicks LIMIT 1'
      );
      expect(r.rows).toEqual([]);
    });

    it('authenticated CANNOT SELECT from affiliate_clicks', async () => {
      const r = await asRole<{ id: string }>(
        pool,
        'authenticated',
        userId,
        'SELECT id FROM public.affiliate_clicks LIMIT 1'
      );
      expect(r.rows).toEqual([]);
    });

    it('anon CANNOT INSERT into ai_usage', async () => {
      await expect(
        asRole(
          pool,
          'anon',
          null,
          `INSERT INTO public.ai_usage (route, cost_cents, model_used)
             VALUES ('lookup', 1, 'blocked-model')`
        )
      ).rejects.toThrow(/row-level security|permission denied/i);
    });

    it('authenticated CANNOT INSERT into non_nyc_waitlist', async () => {
      await expect(
        asRole(
          pool,
          'authenticated',
          userId,
          `INSERT INTO public.non_nyc_waitlist
             (email, attempted_address, requested_city, requested_state)
           VALUES ('hax@x.com', '123 X St', 'Chicago', 'IL')`
        )
      ).rejects.toThrow(/row-level security|permission denied/i);
    });

    it('anon CANNOT SELECT from refunds', async () => {
      const r = await asRole<{ id: string }>(
        pool,
        'anon',
        null,
        'SELECT id FROM public.refunds LIMIT 1'
      );
      expect(r.rows).toEqual([]);
    });

    it('authenticated CANNOT SELECT from refunds', async () => {
      const r = await asRole<{ id: string }>(
        pool,
        'authenticated',
        userId,
        'SELECT id FROM public.refunds LIMIT 1'
      );
      expect(r.rows).toEqual([]);
    });
  });
});
