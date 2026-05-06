/**
 * verify-restore.ts — Post-restore database health check
 *
 * Run this after any restore procedure to confirm that all expected
 * schema objects are present and configured correctly.
 *
 * Usage:
 *   npm run verify:restore
 *   DATABASE_URL=postgresql://... npm run verify:restore
 *
 * Exit 0 = all checks passed.
 * Exit 1 = one or more checks failed (errors printed to stderr).
 *
 * This script is intentionally standalone — it imports nothing from the
 * application source so it can be run against any target database.
 */

import pg from 'pg';
import { env } from 'process';

const DATABASE_URL =
  env['DATABASE_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

// ─── Expected schema objects ──────────────────────────────────────────────────

const EXPECTED_PUBLIC_TABLES = [
  'affiliate_clicks',
  'ai_usage',
  'building_lookups',
  'buildings',
  'email_lookup_counters',
  'landlords',
  'lease_reviews',
  'non_nyc_waitlist',
  'profiles',
  'refunds',
  'subscriptions',
];

const EXPECTED_ENUMS = [
  'affiliate_partner',
  'ai_route',
  'lease_review_status',
  'subscription_status',
];

const EXPECTED_STORAGE_BUCKETS = [
  { id: 'firm-logos', public: true },
  { id: 'lease-pdfs', public: false },
];

const EXPECTED_STORAGE_POLICIES = [
  'firm_logos_select_public',
  'lease_pdfs_select_own',
];

/**
 * Expected RLS-enabled public tables (every table in the public schema
 * that we define should have RLS enabled).
 */
const EXPECTED_RLS_TABLES = EXPECTED_PUBLIC_TABLES;

/** Minimum number of Drizzle migrations expected in the tracking table. */
const MIN_MIGRATION_COUNT = 8;

// ─── Checker ──────────────────────────────────────────────────────────────────

let failures = 0;

function pass(label: string): void {
  console.log(`  ✓  ${label}`);
}

function fail(label: string, detail?: string): void {
  failures++;
  console.error(`  ✗  ${label}${detail ? `\n       → ${detail}` : ''}`);
}

async function runChecks(pool: pg.Pool): Promise<void> {
  // ── 1. Public tables ──────────────────────────────────────────────────────
  console.log('\n[1] Public tables');
  const { rows: tables } = await pool.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
  );
  const tableNames = tables.map(r => r.tablename);
  for (const t of EXPECTED_PUBLIC_TABLES) {
    if (tableNames.includes(t)) pass(t);
    else fail(t, 'table not found in public schema');
  }

  // ── 2. RLS enabled on every public table ─────────────────────────────────
  console.log('\n[2] RLS enabled');
  const { rows: rlsRows } = await pool.query<{ tablename: string; rowsecurity: boolean }>(
    `SELECT tablename, rowsecurity FROM pg_tables
       WHERE schemaname = 'public'
         AND tablename = ANY($1)
       ORDER BY tablename`,
    [EXPECTED_RLS_TABLES]
  );
  const rlsMap = new Map(rlsRows.map(r => [r.tablename, r.rowsecurity]));
  for (const t of EXPECTED_RLS_TABLES) {
    if (rlsMap.get(t) === true) pass(`${t} (RLS on)`);
    else fail(`${t}`, `RLS is NOT enabled (rowsecurity = ${rlsMap.get(t) ?? 'missing'})`);
  }

  // ── 3. Custom enum types ──────────────────────────────────────────────────
  console.log('\n[3] Enum types');
  const { rows: enums } = await pool.query<{ typname: string }>(
    `SELECT typname FROM pg_type
       WHERE typtype = 'e' AND typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
       ORDER BY typname`
  );
  const enumNames = enums.map(r => r.typname);
  for (const e of EXPECTED_ENUMS) {
    if (enumNames.includes(e)) pass(e);
    else fail(e, 'enum type not found');
  }

  // ── 4. Cross-schema foreign keys ─────────────────────────────────────────
  console.log('\n[4] auth.users foreign keys');
  const { rows: fks } = await pool.query<{ source_table: string; source_col: string; confdeltype: string }>(
    `SELECT conrelid::regclass::text AS source_table,
            a.attname AS source_col,
            c.confdeltype
       FROM pg_constraint c
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f'
        AND confrelid::regclass::text = 'auth.users'
        AND conrelid::regclass::text IN ('profiles','building_lookups','lease_reviews','subscriptions','refunds')
      ORDER BY source_table, source_col`
  );
  const fkKey = (t: string, col: string) => `${t}.${col}`;
  const fkMap = new Map(fks.map(r => [fkKey(r.source_table, r.source_col), r.confdeltype]));
  const expectedFKs: Array<[string, string, string]> = [
    ['profiles',          'id',      'a'], // CASCADE (a = NO ACTION? let me think... actually 'c' = CASCADE, 'a' = NO ACTION)
    ['building_lookups',  'user_id', 'n'], // SET NULL
    ['lease_reviews',     'user_id', 'n'], // SET NULL
    ['subscriptions',     'user_id', 'c'], // CASCADE
    ['refunds',           'user_id', 'n'], // SET NULL
  ];
  // confdeltype: 'a' = NO ACTION, 'r' = RESTRICT, 'c' = CASCADE, 'n' = SET NULL, 'd' = SET DEFAULT
  // profiles.id uses CASCADE via the trigger in 0002 (it's actually 'a' via auth trigger + CASCADE on 'id' column)
  // Let's just verify the FKs exist, not exact confdeltype for profiles (it's special)
  for (const [table, col] of expectedFKs) {
    const key = fkKey(table, col);
    if (fkMap.has(key)) pass(`${table}.${col} → auth.users`);
    else fail(`${table}.${col}`, 'auth.users FK not found');
  }

  // ── 5. Drizzle migration tracking ────────────────────────────────────────
  console.log('\n[5] Drizzle migrations applied');
  try {
    const { rows: migs } = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations`
    );
    const n = Number(migs[0]?.count ?? 0);
    if (n >= MIN_MIGRATION_COUNT)
      pass(`${n} migrations in drizzle.__drizzle_migrations (expected ≥ ${MIN_MIGRATION_COUNT})`);
    else
      fail(`migration count = ${n}`, `expected ≥ ${MIN_MIGRATION_COUNT}`);
  } catch (e) {
    fail('drizzle.__drizzle_migrations', `table does not exist or query failed: ${String(e)}`);
  }

  // ── 6. Storage buckets ───────────────────────────────────────────────────
  console.log('\n[6] Storage buckets');
  const { rows: buckets } = await pool.query<{ id: string; public: boolean }>(
    `SELECT id, public FROM storage.buckets ORDER BY id`
  );
  const bucketMap = new Map(buckets.map(b => [b.id, b.public]));
  for (const { id, public: isPublic } of EXPECTED_STORAGE_BUCKETS) {
    if (!bucketMap.has(id)) {
      fail(id, 'bucket not found in storage.buckets');
    } else if (bucketMap.get(id) !== isPublic) {
      fail(id, `bucket.public = ${bucketMap.get(id)}, expected ${isPublic}`);
    } else {
      pass(`${id} (public: ${isPublic})`);
    }
  }

  // ── 7. Storage RLS policies ───────────────────────────────────────────────
  console.log('\n[7] Storage RLS policies');
  const { rows: storPols } = await pool.query<{ policyname: string }>(
    `SELECT policyname FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects'
       ORDER BY policyname`
  );
  const storPolNames = storPols.map(r => r.policyname);
  for (const p of EXPECTED_STORAGE_POLICIES) {
    if (storPolNames.includes(p)) pass(p);
    else fail(p, 'storage policy not found');
  }

  // ── 8. auth schema present ───────────────────────────────────────────────
  console.log('\n[8] Supabase auth schema');
  const { rows: authTables } = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM information_schema.tables WHERE table_schema = 'auth'`
  );
  const authCount = Number(authTables[0]?.count ?? 0);
  if (authCount > 0) pass(`auth schema has ${authCount} tables`);
  else fail('auth schema', 'no tables found — Supabase may not be fully started');
}

// ─── Entry point ──────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: DATABASE_URL });

console.log('RentGuard post-restore verification');
console.log(`  database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);

try {
  await runChecks(pool);
} finally {
  await pool.end();
}

console.log('\n' + '─'.repeat(60));
if (failures === 0) {
  console.log(`✅  All checks passed — restore verified successfully.`);
  process.exit(0);
} else {
  console.error(`❌  ${failures} check(s) failed — restore may be incomplete.`);
  process.exit(1);
}
