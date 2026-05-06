/**
 * Phase 1.6 — Supabase Storage integration tests
 *
 * Covers:
 *   • Bucket existence and settings (lease-pdfs private, firm-logos public)
 *   • RLS policy shape on storage.objects
 *   • User-isolation via direct SQL role-switching (tests RLS logic)
 *   • HTTP upload/download/signed-URL behavior via local Supabase Storage API
 *
 * All tests are skipped when DATABASE_URL is unset (same guard as other
 * integration test suites). When DATABASE_URL is set, the local Supabase
 * stack is assumed to be running, which means the Storage API at :54321 is
 * also available.
 *
 * Implementation notes:
 *   • storage.objects has a protect_objects_delete trigger that blocks direct
 *     SQL DELETEs. Cleanup uses SET LOCAL "storage.allow_delete_query" = 'true'
 *     inside a transaction to bypass it for test teardown only.
 *   • The bucket's allowed_mime_types constraint is enforced by the Storage API,
 *     so HTTP uploads use application/pdf and image/png respectively.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
const RUN = typeof DATABASE_URL === 'string' && DATABASE_URL.length > 0;
const describeIfDb = RUN ? describe : describe.skip;

// ─── Local Supabase defaults (deterministic for every `supabase start`) ───────
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const STORAGE_URL  = `${SUPABASE_URL}/storage/v1`;

// Standard local dev JWT (iss: supabase-demo, signed with the well-known dev secret).
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
    '.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0' +
    '.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' +
    '.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9' +
    '.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    apikey: SERVICE_ROLE_KEY,
    ...extra,
  };
}

/**
 * Upload content to storage via the HTTP API (service role).
 * contentType must be in the bucket's allowed_mime_types.
 */
async function storageUpload(
  bucket: string, path: string, body: string, contentType: string
): Promise<Response> {
  return fetch(`${STORAGE_URL}/object/${bucket}/${path}`, {
    method: 'POST',
    headers: serviceHeaders({ 'Content-Type': contentType }),
    body,
  });
}

/** Delete files from a bucket by prefix list (service role, HTTP). */
async function storageDelete(bucket: string, paths: string[]): Promise<void> {
  await fetch(`${STORAGE_URL}/object/${bucket}`, {
    method: 'DELETE',
    headers: serviceHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefixes: paths }),
  }).catch(() => undefined);
}

/**
 * Delete rows from storage.objects that were SQL-inserted for RLS tests.
 * The protect_objects_delete trigger is bypassed via the official GUC:
 *   SET LOCAL "storage.allow_delete_query" = 'true'
 * This is intentionally scoped to a single transaction.
 */
async function sqlDeleteStorageObject(pool: pg.Pool, bucket: string, name: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "storage.allow_delete_query" = 'true'`);
    await client.query(
      `DELETE FROM storage.objects WHERE bucket_id = $1 AND name = $2`,
      [bucket, name]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Run SQL under an RLS-enforced role (always rolled back). */
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

async function createAuthUser(pool: pg.Pool, tag: string): Promise<string> {
  const { rows: [row] } = await pool.query<{ id: string }>(
    `INSERT INTO auth.users
       (id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data, aud, role)
     VALUES
       (gen_random_uuid(), $1, '', now(), now(), now(), '{}', '{}', 'authenticated', 'authenticated')
     RETURNING id`,
    [`test-storage-${tag}@rentguard.test`]
  );
  return row!.id;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describeIfDb('Phase 1.6 storage buckets + policies (integration — local Supabase)', () => {
  let pool: pg.Pool;
  let userA: string;
  let userB: string;

  const run = Date.now();
  let leasePathA: string;   // lease-pdfs/{userA}/test-{run}.pdf
  let firmLogoPath: string; // firm-logos/test-org/logo-{run}.png

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
    userA = await createAuthUser(pool, `a-${run}`);
    userB = await createAuthUser(pool, `b-${run}`);
    leasePathA  = `${userA}/test-${run}.pdf`;
    firmLogoPath = `test-org/logo-${run}.png`;
  });

  afterAll(async () => {
    // HTTP-uploaded test files
    await storageDelete('lease-pdfs', [leasePathA, `${userA}/signed-test-${run}.pdf`]);
    await storageDelete('firm-logos', [firmLogoPath]);
    // Remove test auth users (storage rows were cleaned up per-test)
    await pool.query('DELETE FROM auth.users WHERE id = ANY($1)', [[userA, userB]]);
    await pool.end();
  });

  // ─── Bucket configuration ──────────────────────────────────────────────────

  describe('bucket configuration', () => {
    it('lease-pdfs exists and is private (public: false)', async () => {
      const { rows } = await pool.query<{ id: string; public: boolean; file_size_limit: string }>(
        `SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'lease-pdfs'`
      );
      expect(rows[0]?.id).toBe('lease-pdfs');
      expect(rows[0]?.public).toBe(false);
      expect(Number(rows[0]?.file_size_limit)).toBe(52428800); // 50 MB
    });

    it('firm-logos exists and is public (public: true)', async () => {
      const { rows } = await pool.query<{ id: string; public: boolean; file_size_limit: string }>(
        `SELECT id, public, file_size_limit FROM storage.buckets WHERE id = 'firm-logos'`
      );
      expect(rows[0]?.id).toBe('firm-logos');
      expect(rows[0]?.public).toBe(true);
      expect(Number(rows[0]?.file_size_limit)).toBe(5242880); // 5 MB
    });

    it('lease-pdfs only allows application/pdf MIME type', async () => {
      const { rows } = await pool.query<{ allowed_mime_types: string[] }>(
        `SELECT allowed_mime_types FROM storage.buckets WHERE id = 'lease-pdfs'`
      );
      expect(rows[0]?.allowed_mime_types).toEqual(['application/pdf']);
    });

    it('firm-logos allows image MIME types', async () => {
      const { rows } = await pool.query<{ allowed_mime_types: string[] }>(
        `SELECT allowed_mime_types FROM storage.buckets WHERE id = 'firm-logos'`
      );
      expect(rows[0]?.allowed_mime_types).toEqual(
        expect.arrayContaining(['image/jpeg', 'image/png'])
      );
    });
  });

  // ─── RLS policy shape ──────────────────────────────────────────────────────

  describe('RLS policy shape', () => {
    it('creates exactly two storage object policies (one per bucket)', async () => {
      const { rows } = await pool.query<{ policyname: string; cmd: string; role_list: string }>(
        `SELECT policyname, cmd, array_to_string(roles,',') AS role_list
           FROM pg_policies
           WHERE schemaname = 'storage' AND tablename = 'objects'
             AND policyname IN ('lease_pdfs_select_own','firm_logos_select_public')
           ORDER BY policyname`
      );
      expect(rows).toEqual([
        { policyname: 'firm_logos_select_public', cmd: 'SELECT', role_list: 'anon,authenticated' },
        { policyname: 'lease_pdfs_select_own',    cmd: 'SELECT', role_list: 'authenticated' },
      ]);
    });

    it('no INSERT/UPDATE/DELETE policies on storage.objects (all writes are service-role only)', async () => {
      const { rows } = await pool.query<{ cmd: string }>(
        `SELECT cmd FROM pg_policies
           WHERE schemaname = 'storage' AND tablename = 'objects'
             AND cmd IN ('INSERT','UPDATE','DELETE')`
      );
      expect(rows).toHaveLength(0);
    });

    it('lease_pdfs_select_own uses foldername path isolation referencing auth.uid()', async () => {
      const { rows } = await pool.query<{ qual: string }>(
        `SELECT qual FROM pg_policies
           WHERE schemaname = 'storage' AND tablename = 'objects'
             AND policyname = 'lease_pdfs_select_own'`
      );
      expect(rows[0]?.qual).toContain('storage.foldername(name)');
      expect(rows[0]?.qual).toContain('auth.uid()');
      expect(rows[0]?.qual).toContain('lease-pdfs');
    });
  });

  // ─── HTTP: service-role uploads ────────────────────────────────────────────

  describe('service-role uploads via HTTP', () => {
    it('uploads a PDF to lease-pdfs with application/pdf MIME type → 200', async () => {
      const res = await storageUpload('lease-pdfs', leasePathA, '%PDF-1.4 test content', 'application/pdf');
      expect([200, 201]).toContain(res.status);
    });

    it('uploads an image to firm-logos with image/png MIME type → 200', async () => {
      const res = await storageUpload('firm-logos', firmLogoPath, 'PNG_TEST_BYTES', 'image/png');
      expect([200, 201]).toContain(res.status);
    });

    it('rejects upload to lease-pdfs with wrong MIME type (415)', async () => {
      const res = await storageUpload(
        'lease-pdfs', `${userA}/wrong-mime-${run}.pdf`, 'data', 'image/png'
      );
      expect(res.status).toBe(400); // Supabase returns 400 for mime-type violations
    });
  });

  // ─── HTTP: download access control ─────────────────────────────────────────

  describe('download access control (HTTP)', () => {
    it('service role can download the private lease PDF', async () => {
      const res = await fetch(`${STORAGE_URL}/object/lease-pdfs/${leasePathA}`, {
        headers: serviceHeaders(),
      });
      expect(res.status).toBe(200);
    });

    it('anon key CANNOT download a private lease PDF (no anon SELECT policy)', async () => {
      const res = await fetch(`${STORAGE_URL}/object/lease-pdfs/${leasePathA}`, {
        headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
      });
      // Supabase hides existence for RLS-blocked objects — returns 400, not 200
      expect(res.status).not.toBe(200);
    });

    it('firm-logos file is readable with anon key (public SELECT policy → 200)', async () => {
      const res = await fetch(`${STORAGE_URL}/object/firm-logos/${firmLogoPath}`, {
        headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
      });
      expect(res.status).toBe(200);
    });

    it('firm-logos file is readable via /object/public/ URL (no auth header needed)', async () => {
      const res = await fetch(`${STORAGE_URL}/object/public/firm-logos/${firmLogoPath}`);
      expect(res.status).toBe(200);
    });
  });

  // ─── HTTP: signed URLs ─────────────────────────────────────────────────────

  describe('signed-URL access for lease-pdfs (HTTP)', () => {
    it('service role can generate a signed download URL', async () => {
      const res = await fetch(`${STORAGE_URL}/object/sign/lease-pdfs/${leasePathA}`, {
        method: 'POST',
        headers: serviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { signedURL?: string };
      expect(typeof body.signedURL).toBe('string');
      expect(body.signedURL).toContain('token=');
    });

    it('signed URL is accessible without any auth token (anonymous flow)', async () => {
      const signRes = await fetch(`${STORAGE_URL}/object/sign/lease-pdfs/${leasePathA}`, {
        method: 'POST',
        headers: serviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: 3600 }),
      });
      expect(signRes.status).toBe(200);
      const { signedURL } = await signRes.json() as { signedURL: string };

      // signedURL is relative to the storage base (/storage/v1): "/object/sign/..."
      // Fetch it without any Authorization or apikey headers.
      const fileRes = await fetch(`${STORAGE_URL}${signedURL}`);
      expect(fileRes.status).toBe(200);
      const text = await fileRes.text();
      expect(text).toContain('%PDF-1.4');
    });

    it('signed upload URL lets the backend issue a one-time upload token', async () => {
      const uploadPath = `${userA}/signed-test-${run}.pdf`;
      const res = await fetch(`${STORAGE_URL}/object/upload/sign/lease-pdfs/${uploadPath}`, {
        method: 'POST',
        headers: serviceHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn: 300 }),
      });
      // Returns the upload signed URL token
      expect(res.status).toBe(200);
      const body = await res.json() as { url?: string; token?: string };
      expect(typeof (body.url ?? body.token)).toBe('string');
    });
  });

  // ─── SQL: RLS user isolation ───────────────────────────────────────────────

  describe('RLS user isolation (SQL)', () => {
    it('user A CAN SELECT their own lease-pdf object', async () => {
      const name = `${userA}/rls-own-${run}.pdf`;
      await pool.query(
        `INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
        ['lease-pdfs', name, userA]
      );

      const r = await asRole<{ name: string }>(
        pool, 'authenticated', userA,
        `SELECT name FROM storage.objects WHERE bucket_id = 'lease-pdfs' AND name = $1`,
        [name]
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.name).toBe(name);

      await sqlDeleteStorageObject(pool, 'lease-pdfs', name);
    });

    it("user B CANNOT SELECT user A's lease-pdf object (cross-user isolation)", async () => {
      const name = `${userA}/rls-xuser-${run}.pdf`;
      await pool.query(
        `INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
        ['lease-pdfs', name, userA]
      );

      const r = await asRole<{ name: string }>(
        pool, 'authenticated', userB,
        `SELECT name FROM storage.objects WHERE bucket_id = 'lease-pdfs' AND name = $1`,
        [name]
      );
      expect(r.rows).toHaveLength(0);

      await sqlDeleteStorageObject(pool, 'lease-pdfs', name);
    });

    it('anon role CANNOT SELECT any lease-pdf objects (no anon SELECT policy)', async () => {
      const name = `${userA}/rls-anon-${run}.pdf`;
      await pool.query(
        `INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
        ['lease-pdfs', name, userA]
      );

      const r = await asRole<{ name: string }>(
        pool, 'anon', null,
        `SELECT name FROM storage.objects WHERE bucket_id = 'lease-pdfs' AND name = $1`,
        [name]
      );
      expect(r.rows).toHaveLength(0);

      await sqlDeleteStorageObject(pool, 'lease-pdfs', name);
    });

    it('anon role CAN SELECT firm-logos objects (public SELECT policy)', async () => {
      const name = `test-org/rls-anon-logo-${run}.png`;
      await pool.query(
        `INSERT INTO storage.objects (bucket_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        ['firm-logos', name]
      );

      const r = await asRole<{ name: string }>(
        pool, 'anon', null,
        `SELECT name FROM storage.objects WHERE bucket_id = 'firm-logos' AND name = $1`,
        [name]
      );
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]?.name).toBe(name);

      await sqlDeleteStorageObject(pool, 'firm-logos', name);
    });

    it('authenticated CAN SELECT firm-logos objects (public SELECT policy)', async () => {
      const name = `test-org/rls-auth-logo-${run}.png`;
      await pool.query(
        `INSERT INTO storage.objects (bucket_id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        ['firm-logos', name]
      );

      const r = await asRole<{ name: string }>(
        pool, 'authenticated', userA,
        `SELECT name FROM storage.objects WHERE bucket_id = 'firm-logos' AND name = $1`,
        [name]
      );
      expect(r.rows).toHaveLength(1);

      await sqlDeleteStorageObject(pool, 'firm-logos', name);
    });

    it('anon CANNOT INSERT into storage.objects (no INSERT policy)', async () => {
      await expect(
        asRole(
          pool, 'anon', null,
          `INSERT INTO storage.objects (bucket_id, name) VALUES ('lease-pdfs', 'anon/inject.pdf')`
        )
      ).rejects.toThrow(/row-level security|permission denied/i);
    });
  });
});
