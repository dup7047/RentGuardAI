// /v1/saved-buildings — per-user "saved buildings" list.
//
// All endpoints require an authenticated user (Supabase JWT in
// Authorization: Bearer <token>). Anonymous requests return 401; the
// frontend uses that to gate the SignInModal.

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getDb, getPool } from '../db/client.js';
import { savedBuildings, profiles } from '../db/schema.js';
import { AppError } from '../lib/errors.js';

type Vars = { anonToken: string; userId?: string; userEmail?: string };

export const savedBuildingsRoute = new Hono<{ Variables: Vars }>();

const BblParam = z.string().regex(/^\d{10}$/);

/**
 * Resolve the authed user ID or throw `unauthorized`. Returns a non-empty
 * string so callers don't need to null-check.
 */
function requireAuthedUserId(c: Context<{ Variables: Vars }>): string {
  const userId = c.get('userId');
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new AppError('unauthorized', 'Sign in to use saved buildings.');
  }
  return userId;
}

function parseBblOrThrow(value: string | undefined): string {
  const r = BblParam.safeParse(value);
  if (!r.success) throw new AppError('validation_failed', 'BBL must be a 10-digit number.');
  return r.data;
}

type SavedBuildingRow = {
  bbl: string;
  address: string | null;
  borough: string | null;
  saved_at: Date;
  score: number | null;
  score_band: string | null;
};

// GET /v1/saved-buildings — list of saved buildings for the current user.
// Joins `buildings` for address/borough and the latest `building_lookups`
// row for each BBL (via LATERAL) to surface the most recent score on the
// dashboard list. Both joins are LEFT — defensively handles missing rows.
savedBuildingsRoute.get('/saved-buildings', async (c) => {
  const userId = requireAuthedUserId(c);

  const pool = getPool();
  const listResult = await pool.query<SavedBuildingRow>(
    `SELECT
       sb.bbl,
       b.address,
       b.borough,
       sb.created_at AS saved_at,
       bl.ai_score AS score,
       bl.ai_score_band AS score_band
     FROM saved_buildings sb
     LEFT JOIN buildings b ON b.bbl = sb.bbl
     LEFT JOIN LATERAL (
       SELECT ai_score, ai_score_band
       FROM building_lookups
       WHERE building_bbl = sb.bbl
       ORDER BY created_at DESC
       LIMIT 1
     ) bl ON true
     WHERE sb.user_id = $1
     ORDER BY sb.created_at DESC
     LIMIT 100`,
    [userId],
  );

  const countResult = await pool.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM saved_buildings WHERE user_id = $1`,
    [userId],
  );
  const totalCount = Number.parseInt(countResult.rows[0]?.total ?? '0', 10);

  return c.json({
    items: listResult.rows.map((r) => ({
      bbl: r.bbl,
      address: r.address,
      borough: r.borough,
      saved_at: r.saved_at.toISOString(),
      score: r.score,
      score_band: r.score_band,
    })),
    total_count: totalCount,
  });
});

// GET /v1/saved-buildings/:bbl — has the current user saved this BBL?
savedBuildingsRoute.get('/saved-buildings/:bbl', async (c) => {
  const userId = requireAuthedUserId(c);
  const bbl = parseBblOrThrow(c.req.param('bbl'));

  const rows = await getDb()
    .select({ createdAt: savedBuildings.createdAt })
    .from(savedBuildings)
    .where(and(eq(savedBuildings.userId, userId), eq(savedBuildings.bbl, bbl)))
    .limit(1);

  const row = rows[0];
  if (!row) return c.json({ saved: false });
  return c.json({ saved: true, saved_at: row.createdAt.toISOString() });
});

// POST /v1/saved-buildings — body { bbl }. Idempotent: re-saving an
// already-saved BBL returns the original saved_at, not a new one.
const SaveBody = z.object({ bbl: BblParam });

savedBuildingsRoute.post('/saved-buildings', async (c) => {
  const userId = requireAuthedUserId(c);

  const parsed = SaveBody.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    throw new AppError('validation_failed', 'BBL must be a 10-digit number.');
  }
  const { bbl } = parsed.data;

  // Self-heal the profiles row before inserting into saved_buildings.
  // saved_buildings.user_id has a FK to profiles(id), but Supabase signups
  // only populate auth.users — there's no trigger creating a matching
  // profiles row. Without this upsert the very first save by a fresh user
  // fails with `saved_buildings_user_id_fkey` and Render returns a 500.
  // ON CONFLICT DO NOTHING keeps the call cheap on every subsequent save.
  const userEmail = c.get('userEmail') ?? '';
  await getDb()
    .insert(profiles)
    .values({ id: userId, email: userEmail })
    .onConflictDoNothing({ target: profiles.id });

  // INSERT … ON CONFLICT DO NOTHING RETURNING. When the row already exists
  // the RETURNING clause is empty, so we follow up with a SELECT to fetch
  // the original created_at — keeps the response shape uniform regardless
  // of whether the insert was a fresh save or a no-op.
  const inserted = await getDb()
    .insert(savedBuildings)
    .values({ userId, bbl })
    .onConflictDoNothing({ target: [savedBuildings.userId, savedBuildings.bbl] })
    .returning({ createdAt: savedBuildings.createdAt });

  let createdAt = inserted[0]?.createdAt;
  if (!createdAt) {
    const existing = await getDb()
      .select({ createdAt: savedBuildings.createdAt })
      .from(savedBuildings)
      .where(and(eq(savedBuildings.userId, userId), eq(savedBuildings.bbl, bbl)))
      .limit(1);
    createdAt = existing[0]?.createdAt;
  }
  if (!createdAt) {
    // Defensive — shouldn't happen unless the row was deleted between
    // INSERT and SELECT. Treat as a fresh save with the current timestamp.
    createdAt = new Date();
  }

  return c.json({ saved: true, saved_at: createdAt.toISOString() });
});

// DELETE /v1/saved-buildings/:bbl — unsave. Idempotent: deleting a row that
// doesn't exist is not an error; the response shape is the same.
savedBuildingsRoute.delete('/saved-buildings/:bbl', async (c) => {
  const userId = requireAuthedUserId(c);
  const bbl = parseBblOrThrow(c.req.param('bbl'));

  await getDb()
    .delete(savedBuildings)
    .where(and(eq(savedBuildings.userId, userId), eq(savedBuildings.bbl, bbl)));

  return c.json({ saved: false });
});
