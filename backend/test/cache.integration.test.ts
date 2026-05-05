import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0;
const describeIfDb = RUN ? describe : describe.skip;

async function asRole<T extends pg.QueryResultRow>(
  pool: pg.Pool,
  role: 'anon' | 'authenticated',
  sql: string,
  params: unknown[] = []
): Promise<pg.QueryResult<T>> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL ROLE ${role}`);
    await client.query(`SELECT set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ role }),
    ]);
    return await client.query<T>(sql, params);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describeIfDb('Phase 1.4 cache tables (integration — local Supabase)', () => {
  let pool: pg.Pool;
  // 10-digit BBL — Manhattan/Block 824/Lot 1 (Empire State Building).
  const bbl = '1008240001';
  const otherBbl = '1009870042';

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    await pool.query('DELETE FROM public.building_lookups WHERE building_bbl = ANY($1)', [
      [bbl, otherBbl],
    ]);
    await pool.query('DELETE FROM public.buildings WHERE bbl = ANY($1)', [[bbl, otherBbl]]);
    await pool.query("DELETE FROM public.landlords WHERE registered_owner_name LIKE 'TEST_%'");
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM public.building_lookups WHERE building_bbl = ANY($1)', [
      [bbl, otherBbl],
    ]);
    await pool.query('DELETE FROM public.buildings WHERE bbl = ANY($1)', [[bbl, otherBbl]]);
    await pool.query("DELETE FROM public.landlords WHERE registered_owner_name LIKE 'TEST_%'");
  });

  describe('schema shape', () => {
    it('creates buildings + landlords with RLS enabled', async () => {
      const { rows } = await pool.query<{ tablename: string; rowsecurity: boolean }>(
        `SELECT tablename, rowsecurity FROM pg_tables
           WHERE schemaname = 'public'
             AND tablename IN ('buildings','landlords')
           ORDER BY tablename`
      );
      expect(rows).toEqual([
        { tablename: 'buildings', rowsecurity: true },
        { tablename: 'landlords', rowsecurity: true },
      ]);
    });

    it('declares one public-SELECT policy per cache table and no INSERT/UPDATE/DELETE policies', async () => {
      const { rows } = await pool.query<{
        policyname: string;
        tablename: string;
        cmd: string;
        role_list: string;
      }>(
        `SELECT policyname, tablename, cmd, array_to_string(roles, ',') AS role_list
           FROM pg_policies
           WHERE schemaname = 'public'
             AND tablename IN ('buildings','landlords')
           ORDER BY tablename, policyname`
      );
      expect(rows).toEqual([
        {
          policyname: 'buildings_select_public',
          tablename: 'buildings',
          cmd: 'SELECT',
          role_list: 'anon,authenticated',
        },
        {
          policyname: 'landlords_select_public',
          tablename: 'landlords',
          cmd: 'SELECT',
          role_list: 'anon,authenticated',
        },
      ]);
    });

    it('wires building_lookups.building_bbl → buildings.bbl ON DELETE SET NULL', async () => {
      const { rows } = await pool.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def
           FROM pg_constraint
           WHERE conname = 'building_lookups_building_bbl_fkey'`
      );
      expect(rows[0]?.def).toMatch(
        /FOREIGN KEY \(building_bbl\) REFERENCES buildings\(bbl\) ON DELETE SET NULL/
      );
    });
  });

  describe('FK behavior — building_lookups.building_bbl', () => {
    it('rejects a lookup whose building_bbl is not in the buildings cache', async () => {
      await expect(
        pool.query(
          `INSERT INTO public.building_lookups (address_input, building_bbl)
             VALUES ($1, $2)`,
          ['350 5th Ave', bbl]
        )
      ).rejects.toThrow(/building_lookups_building_bbl_fkey|foreign key/i);
    });

    it('SET NULLs building_bbl when the cached building row is deleted', async () => {
      await pool.query(
        `INSERT INTO public.buildings (bbl, address, borough)
           VALUES ($1, $2, $3)`,
        [bbl, '350 5th Ave', 'Manhattan']
      );
      const { rows: [look] } = await pool.query<{ id: string }>(
        `INSERT INTO public.building_lookups (address_input, building_bbl)
           VALUES ($1, $2) RETURNING id`,
        ['350 5th Ave', bbl]
      );
      await pool.query('DELETE FROM public.buildings WHERE bbl = $1', [bbl]);

      const { rows } = await pool.query<{ building_bbl: string | null }>(
        'SELECT building_bbl FROM public.building_lookups WHERE id = $1',
        [look!.id]
      );
      expect(rows[0]?.building_bbl).toBeNull();

      await pool.query('DELETE FROM public.building_lookups WHERE id = $1', [look!.id]);
    });

    it('allows a lookup with NULL building_bbl (geocode failure / non-NYC)', async () => {
      const { rows: [created] } = await pool.query<{ id: string }>(
        `INSERT INTO public.building_lookups (address_input)
           VALUES ($1) RETURNING id`,
        ['1600 Pennsylvania Ave Washington DC']
      );
      expect(created?.id).toBeTruthy();
      await pool.query('DELETE FROM public.building_lookups WHERE id = $1', [created!.id]);
    });
  });

  describe('RLS — anon role', () => {
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO public.buildings (bbl, address, borough, raw_data)
           VALUES ($1, $2, $3, $4)`,
        [bbl, '350 5th Ave', 'Manhattan', { hpdViolations: 12 }]
      );
      await pool.query(
        `INSERT INTO public.landlords (registered_owner_name, hpd_corporation_name, watchlist_rank)
           VALUES ($1, $2, $3)`,
        ['TEST_EMPIRE_OWNER LLC', 'TEST_EMPIRE_OWNER_CORP', 7]
      );
    });

    it('anon CAN SELECT from buildings', async () => {
      const r = await asRole<{ bbl: string; address: string }>(
        pool,
        'anon',
        'SELECT bbl, address FROM public.buildings WHERE bbl = $1',
        [bbl]
      );
      expect(r.rows).toEqual([{ bbl, address: '350 5th Ave' }]);
    });

    it('anon CAN SELECT from landlords', async () => {
      const r = await asRole<{ registered_owner_name: string; watchlist_rank: number | null }>(
        pool,
        'anon',
        "SELECT registered_owner_name, watchlist_rank FROM public.landlords WHERE registered_owner_name = 'TEST_EMPIRE_OWNER LLC'"
      );
      expect(r.rows).toEqual([{ registered_owner_name: 'TEST_EMPIRE_OWNER LLC', watchlist_rank: 7 }]);
    });

    it('anon CANNOT INSERT into buildings', async () => {
      await expect(
        asRole(
          pool,
          'anon',
          `INSERT INTO public.buildings (bbl, address, borough) VALUES ($1, $2, $3)`,
          [otherBbl, 'fake', 'Manhattan']
        )
      ).rejects.toThrow(/row-level security|permission denied/i);
    });

    it('anon CANNOT UPDATE buildings (no UPDATE policy)', async () => {
      const r = await asRole(
        pool,
        'anon',
        `UPDATE public.buildings SET address = 'pwned' WHERE bbl = $1`,
        [bbl]
      );
      expect(r.rowCount).toBe(0);
      const verify = await pool.query<{ address: string }>(
        'SELECT address FROM public.buildings WHERE bbl = $1',
        [bbl]
      );
      expect(verify.rows[0]?.address).toBe('350 5th Ave');
    });

    it('anon CANNOT DELETE from landlords (no DELETE policy)', async () => {
      const r = await asRole(
        pool,
        'anon',
        "DELETE FROM public.landlords WHERE registered_owner_name = 'TEST_EMPIRE_OWNER LLC'"
      );
      expect(r.rowCount).toBe(0);
      const verify = await pool.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM public.landlords WHERE registered_owner_name = 'TEST_EMPIRE_OWNER LLC'"
      );
      expect(Number(verify.rows[0]?.count)).toBe(1);
    });
  });

  describe('RLS — authenticated role behaves like anon for cache tables', () => {
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO public.buildings (bbl, address, borough) VALUES ($1, $2, $3)`,
        [bbl, '350 5th Ave', 'Manhattan']
      );
    });

    it('authenticated CAN SELECT from buildings', async () => {
      const r = await asRole<{ bbl: string }>(
        pool,
        'authenticated',
        'SELECT bbl FROM public.buildings WHERE bbl = $1',
        [bbl]
      );
      expect(r.rows).toEqual([{ bbl }]);
    });

    it('authenticated CANNOT INSERT a landlord (would let users poison the cache)', async () => {
      await expect(
        asRole(
          pool,
          'authenticated',
          `INSERT INTO public.landlords (registered_owner_name) VALUES ($1)`,
          ['TEST_HOSTILE_OWNER']
        )
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });

  describe('service-role write path (postgres superuser bypasses RLS)', () => {
    it('upserts a building and updates last_fetched_at', async () => {
      const t1 = new Date('2026-01-01T00:00:00Z');
      await pool.query(
        `INSERT INTO public.buildings (bbl, address, borough, last_fetched_at, raw_data)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (bbl) DO UPDATE
             SET address = EXCLUDED.address,
                 borough = EXCLUDED.borough,
                 last_fetched_at = EXCLUDED.last_fetched_at,
                 raw_data = EXCLUDED.raw_data`,
        [bbl, '350 5th Ave', 'Manhattan', t1, { hpdViolations: 0 }]
      );
      const t2 = new Date('2026-05-05T00:00:00Z');
      await pool.query(
        `INSERT INTO public.buildings (bbl, address, borough, last_fetched_at, raw_data)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (bbl) DO UPDATE
             SET address = EXCLUDED.address,
                 borough = EXCLUDED.borough,
                 last_fetched_at = EXCLUDED.last_fetched_at,
                 raw_data = EXCLUDED.raw_data`,
        [bbl, '350 5th Ave', 'Manhattan', t2, { hpdViolations: 12 }]
      );
      const { rows } = await pool.query<{
        last_fetched_at: Date;
        raw_data: { hpdViolations: number };
      }>(
        'SELECT last_fetched_at, raw_data FROM public.buildings WHERE bbl = $1',
        [bbl]
      );
      expect(rows[0]?.last_fetched_at.toISOString()).toBe(t2.toISOString());
      expect(rows[0]?.raw_data.hpdViolations).toBe(12);
    });

    it("ignores junk uuid for landlords.id since the column defaults to gen_random_uuid()", async () => {
      const { rows: [row] } = await pool.query<{ id: string; last_fetched_at: Date }>(
        `INSERT INTO public.landlords (registered_owner_name) VALUES ($1)
           RETURNING id, last_fetched_at`,
        ['TEST_DEFAULT_LANDLORD']
      );
      expect(row?.id).toMatch(/^[0-9a-f-]{36}$/i);
      expect(row?.last_fetched_at).toBeInstanceOf(Date);
    });
  });
});
