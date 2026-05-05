import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0;
const describeIfDb = RUN ? describe : describe.skip;

describeIfDb('migrate.ts (integration — requires DATABASE_URL pointing at local Supabase)', () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    await runMigrations(DATABASE_URL);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('records the baseline migration in drizzle.__drizzle_migrations', async () => {
    const { rows } = await pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations'
    );
    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });

  it('confirms the Supabase auth.users table is present (proves we ran against Supabase, not bare Postgres)', async () => {
    const { rows } = await pool.query<{ exists: boolean }>(
      "select to_regclass('auth.users') is not null as exists"
    );
    expect(rows[0]?.exists).toBe(true);
  });

  it('is idempotent — re-running does not duplicate the baseline row', async () => {
    const before = await pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations'
    );
    await runMigrations(DATABASE_URL);
    const after = await pool.query<{ count: string }>(
      'select count(*)::text as count from drizzle.__drizzle_migrations'
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });
});
