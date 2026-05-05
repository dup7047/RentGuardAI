import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0;
const describeIfDb = RUN ? describe : describe.skip;

// Helper: run SQL inside a transaction with a specific Postgres role + JWT
// claims so PostgREST/Supabase RLS policies behave as if the request came
// from that role. Returns the query result. Always rolls back so tests are
// isolated.
async function asRole<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  role: 'anon' | 'authenticated',
  jwtSub: string | null,
  sql: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    const claims = jwtSub
      ? JSON.stringify({ sub: jwtSub, role })
      : JSON.stringify({ role });
    // SET LOCAL doesn't accept parameter binding; use set_config() which does.
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [claims]);
    return await client.query<T>(sql, params);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describeIfDb('Phase 1.3 schema (integration — local Supabase)', () => {
  let pool: pg.Pool;
  // Two test users created fresh per suite run so tests don't collide with
  // each other or with prior runs.
  const userA = randomUUID();
  const userB = randomUUID();

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    // Ensure clean slate — these tests own these UUIDs.
    await pool.query("DELETE FROM auth.users WHERE id = ANY($1)", [[userA, userB]]);
    await pool.query(
      `INSERT INTO auth.users (id, email) VALUES ($1, $2), ($3, $4)`,
      [userA, `${userA}@test.local`, userB, `${userB}@test.local`]
    );
  });

  afterAll(async () => {
    // Cascade cleanup: deleting from auth.users drops profiles and nulls
    // building_lookups/lease_reviews user_id thanks to the FKs we added.
    await pool.query("DELETE FROM auth.users WHERE id = ANY($1)", [[userA, userB]]);
    await pool.end();
  });

  describe('schema shape', () => {
    it('creates all four public tables with RLS enabled', async () => {
      const { rows } = await pool.query<{ tablename: string; rowsecurity: boolean }>(
        `SELECT tablename, rowsecurity FROM pg_tables
           WHERE schemaname = 'public'
             AND tablename IN ('profiles','email_lookup_counters','building_lookups','lease_reviews')
           ORDER BY tablename`
      );
      expect(rows.map((r) => r.tablename)).toEqual([
        'building_lookups',
        'email_lookup_counters',
        'lease_reviews',
        'profiles',
      ]);
      expect(rows.every((r) => r.rowsecurity === true)).toBe(true);
    });

    it('wires the auth.users foreign keys with the right ON DELETE behavior', async () => {
      const { rows } = await pool.query<{ conname: string; def: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS def
           FROM pg_constraint
           WHERE contype = 'f'
             AND connamespace = 'public'::regnamespace
             AND conname IN ('profiles_id_fkey','building_lookups_user_id_fkey','lease_reviews_user_id_fkey')
           ORDER BY conname`
      );
      const byName = Object.fromEntries(rows.map((r) => [r.conname, r.def]));
      expect(byName['profiles_id_fkey']).toMatch(/REFERENCES auth.users\(id\) ON DELETE CASCADE/);
      expect(byName['building_lookups_user_id_fkey']).toMatch(/REFERENCES auth.users\(id\) ON DELETE SET NULL/);
      expect(byName['lease_reviews_user_id_fkey']).toMatch(/REFERENCES auth.users\(id\) ON DELETE SET NULL/);
    });

    it('declares the four expected RLS policies on the user-scoped tables', async () => {
      const { rows } = await pool.query<{ policyname: string; tablename: string }>(
        `SELECT policyname, tablename FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('profiles','email_lookup_counters','building_lookups','lease_reviews')
           ORDER BY tablename, policyname`
      );
      expect(rows).toEqual([
        { policyname: 'building_lookups_select_own', tablename: 'building_lookups' },
        { policyname: 'lease_reviews_select_own', tablename: 'lease_reviews' },
        { policyname: 'profiles_select_own', tablename: 'profiles' },
        { policyname: 'profiles_update_own', tablename: 'profiles' },
      ]);
      // email_lookup_counters intentionally has no policies — service-role only.
    });
  });

  describe('foreign key behavior', () => {
    it('rejects a profile whose id is not in auth.users', async () => {
      const ghost = randomUUID();
      await expect(
        pool.query(
          `INSERT INTO public.profiles (id, email) VALUES ($1, $2)`,
          [ghost, `${ghost}@test.local`]
        )
      ).rejects.toThrow(/profiles_id_fkey|foreign key/i);
    });

    it('CASCADEs the profile when its auth.users row is deleted', async () => {
      const u = randomUUID();
      await pool.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${u}@test.local`]);
      await pool.query(`INSERT INTO public.profiles (id, email) VALUES ($1, $2)`, [u, `${u}@test.local`]);
      await pool.query(`DELETE FROM auth.users WHERE id = $1`, [u]);
      const { rows } = await pool.query(`SELECT 1 FROM public.profiles WHERE id = $1`, [u]);
      expect(rows).toHaveLength(0);
    });

    it('SET NULLs building_lookups.user_id and lease_reviews.user_id when the user is deleted', async () => {
      const u = randomUUID();
      await pool.query(`INSERT INTO auth.users (id, email) VALUES ($1, $2)`, [u, `${u}@test.local`]);
      const { rows: [look] } = await pool.query<{ id: string }>(
        `INSERT INTO public.building_lookups (user_id, address_input) VALUES ($1, $2) RETURNING id`,
        [u, '350 5th Ave']
      );
      const { rows: [rev] } = await pool.query<{ id: string }>(
        `INSERT INTO public.lease_reviews (user_id, email) VALUES ($1, $2) RETURNING id`,
        [u, `${u}@test.local`]
      );

      await pool.query(`DELETE FROM auth.users WHERE id = $1`, [u]);

      const a = await pool.query<{ user_id: string | null }>(
        `SELECT user_id FROM public.building_lookups WHERE id = $1`, [look!.id]
      );
      const b = await pool.query<{ user_id: string | null }>(
        `SELECT user_id FROM public.lease_reviews WHERE id = $1`, [rev!.id]
      );
      expect(a.rows[0]?.user_id).toBeNull();
      expect(b.rows[0]?.user_id).toBeNull();

      // Cleanup the orphaned rows so they don't leak into other tests.
      await pool.query(`DELETE FROM public.building_lookups WHERE id = $1`, [look!.id]);
      await pool.query(`DELETE FROM public.lease_reviews WHERE id = $1`, [rev!.id]);
    });
  });

  describe('PDF purge pattern (Privacy Policy §6.1)', () => {
    it('keeps ai_report when pdf_storage_path and extracted_text are nulled', async () => {
      const { rows: [created] } = await pool.query<{ id: string }>(
        `INSERT INTO public.lease_reviews
           (user_id, pdf_storage_path, extracted_text, ai_report, status, preview_only)
           VALUES ($1, $2, $3, $4, 'ready', false)
           RETURNING id`,
        [
          userA,
          `lease-pdfs/${userA}/example.pdf`,
          'lease text body...',
          { findings: [{ clause: 'late fee', severity: 'medium' }] },
        ]
      );

      await pool.query(
        `UPDATE public.lease_reviews
           SET pdf_storage_path = NULL,
               extracted_text   = NULL,
               pdf_deleted_at   = now()
           WHERE id = $1`,
        [created!.id]
      );

      const { rows } = await pool.query<{
        pdf_storage_path: string | null;
        extracted_text: string | null;
        ai_report: { findings?: { clause: string }[] } | null;
        pdf_deleted_at: Date | null;
      }>(
        `SELECT pdf_storage_path, extracted_text, ai_report, pdf_deleted_at
           FROM public.lease_reviews WHERE id = $1`,
        [created!.id]
      );

      expect(rows[0]?.pdf_storage_path).toBeNull();
      expect(rows[0]?.extracted_text).toBeNull();
      expect(rows[0]?.ai_report).toEqual({
        findings: [{ clause: 'late fee', severity: 'medium' }],
      });
      expect(rows[0]?.pdf_deleted_at).toBeInstanceOf(Date);

      await pool.query(`DELETE FROM public.lease_reviews WHERE id = $1`, [created!.id]);
    });
  });

  describe('RLS — anonymous role', () => {
    beforeEach(async () => {
      // Seed one row in each user-scoped table for userA so anon has
      // something to fail to read.
      await pool.query(`DELETE FROM public.profiles WHERE id = $1`, [userA]);
      await pool.query(`INSERT INTO public.profiles (id, email) VALUES ($1, $2)`, [userA, 'a@test.local']);
      await pool.query(
        `INSERT INTO public.building_lookups (user_id, address_input) VALUES ($1, $2)`,
        [userA, '350 5th Ave']
      );
      await pool.query(
        `INSERT INTO public.lease_reviews (user_id, email) VALUES ($1, $2)`,
        [userA, 'a@test.local']
      );
      await pool.query(
        `INSERT INTO public.email_lookup_counters (email, reset_at, anon_token, count_30d)
           VALUES ('a@test.local', now() + interval '30 days', gen_random_uuid(), 1)
           ON CONFLICT (email) DO NOTHING`
      );
    });

    it('anon cannot read any rows from profiles, building_lookups, lease_reviews, email_lookup_counters', async () => {
      for (const table of ['profiles', 'building_lookups', 'lease_reviews', 'email_lookup_counters']) {
        const result = await asRole(pool, 'anon', null, `SELECT count(*)::text AS c FROM public.${table}`);
        expect(Number(result.rows[0]?.c)).toBe(0);
      }
    });

    it('anon cannot insert into building_lookups (no INSERT policy granted)', async () => {
      await expect(
        asRole(pool, 'anon', null, `INSERT INTO public.building_lookups (address_input) VALUES ('hack')`)
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  describe('RLS — authenticated role', () => {
    beforeEach(async () => {
      await pool.query(`DELETE FROM public.profiles WHERE id IN ($1, $2)`, [userA, userB]);
      await pool.query(`INSERT INTO public.profiles (id, email) VALUES ($1, $2)`, [userA, 'a@test.local']);
      await pool.query(`INSERT INTO public.profiles (id, email) VALUES ($1, $2)`, [userB, 'b@test.local']);
      await pool.query(
        `INSERT INTO public.building_lookups (user_id, address_input) VALUES ($1, $2), ($3, $4)`,
        [userA, '350 5th Ave', userB, '1 World Trade']
      );
      await pool.query(
        `INSERT INTO public.lease_reviews (user_id, email) VALUES ($1, $2), ($3, $4)`,
        [userA, 'a@test.local', userB, 'b@test.local']
      );
    });

    it('userA can only see their own profile', async () => {
      const r = await asRole<{ id: string }>(
        pool, 'authenticated', userA,
        `SELECT id FROM public.profiles ORDER BY id`
      );
      expect(r.rows).toEqual([{ id: userA }]);
    });

    it('userA can only see their own building_lookups', async () => {
      const r = await asRole<{ user_id: string }>(
        pool, 'authenticated', userA,
        `SELECT user_id FROM public.building_lookups`
      );
      expect(r.rows.every((row) => row.user_id === userA)).toBe(true);
      expect(r.rows.length).toBeGreaterThan(0);
    });

    it('userB cannot see userA lease_reviews', async () => {
      const r = await asRole<{ user_id: string }>(
        pool, 'authenticated', userB,
        `SELECT user_id FROM public.lease_reviews`
      );
      expect(r.rows.every((row) => row.user_id === userB)).toBe(true);
      expect(r.rows.find((row) => row.user_id === userA)).toBeUndefined();
    });

    it('authenticated cannot read email_lookup_counters at all', async () => {
      const r = await asRole(
        pool, 'authenticated', userA,
        `SELECT count(*)::text AS c FROM public.email_lookup_counters`
      );
      expect(Number(r.rows[0]?.c)).toBe(0);
    });

    it("userA cannot UPDATE userB's profile", async () => {
      const r = await asRole(
        pool, 'authenticated', userA,
        `UPDATE public.profiles SET email = 'pwned@test.local' WHERE id = $1 RETURNING id`,
        [userB]
      );
      expect(r.rowCount).toBe(0);
      const verify = await pool.query<{ email: string }>(
        `SELECT email FROM public.profiles WHERE id = $1`, [userB]
      );
      expect(verify.rows[0]?.email).toBe('b@test.local');
    });
  });
});
