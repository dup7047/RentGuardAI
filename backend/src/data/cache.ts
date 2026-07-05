// 24-hour cache layer backed by buildings.raw_data JSONB.
// Each dataset is stored as a key in raw_data; fetch timestamps
// are stored under raw_data._meta.<key>_fetched_at (ISO-8601).

import { getPool } from '../db/client.js';
import type { CachedData, DatasetKey } from './types.js';

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Return cached rows for a given BBL + dataset key, or null if missing / stale.
 */
export async function getCached(bbl: string, key: DatasetKey): Promise<unknown[] | null> {
  const pool = getPool();
  const res = await pool.query<{ raw_data: CachedData }>(
    `SELECT raw_data FROM buildings WHERE bbl = $1 LIMIT 1`,
    [bbl],
  );
  const row = res.rows[0];
  if (!row) return null;
  return readCachedSlice(row.raw_data, key);
}

/**
 * Returns the entire raw_data row for a BBL in one query; pair with
 * `readCachedSlice` to extract per-dataset slices with the same TTL
 * semantics as `getCached`. Null when the row doesn't exist.
 */
export async function getCachedBatch(bbl: string): Promise<CachedData | null> {
  const pool = getPool();
  const res = await pool.query<{ raw_data: CachedData }>(
    `SELECT raw_data FROM buildings WHERE bbl = $1 LIMIT 1`,
    [bbl],
  );
  return res.rows[0]?.raw_data ?? null;
}

/**
 * Extract a fresh dataset slice from a pre-fetched raw_data row, applying the
 * same TTL check as `getCached`. Returns null on miss or stale.
 */
export function readCachedSlice(raw: CachedData | null, key: DatasetKey): unknown[] | null {
  if (!raw) return null;
  const fetchedAt = raw._meta?.[`${key}_fetched_at`];
  if (!fetchedAt) return null;
  if (Date.now() - new Date(fetchedAt).getTime() > TTL_MS) return null;
  const data = raw[key];
  return Array.isArray(data) ? (data as unknown[]) : null;
}

/**
 * Upsert cached rows for a given BBL + dataset key into buildings.raw_data.
 * Uses JSONB merge (|| operator) to update only the affected key, leaving
 * other dataset keys intact.
 */
export async function setCached(
  bbl: string,
  key: DatasetKey,
  rows: unknown[],
  meta: { address?: string; borough?: string } = {},
): Promise<void> {
  const pool = getPool();
  const fetchedAtKey = `${key}_fetched_at`;

  // Initial value for a new row
  const initialJson = JSON.stringify({
    [key]: rows,
    _meta: { [fetchedAtKey]: new Date().toISOString() },
  });

  await pool.query(
    `INSERT INTO buildings (bbl, address, borough, last_fetched_at, raw_data)
     VALUES ($1, $2, $3, NOW(), $4::jsonb)
     ON CONFLICT (bbl) DO UPDATE
       SET raw_data = (
             -- merge new dataset key into existing raw_data
             buildings.raw_data
             || jsonb_build_object($5::text, $6::jsonb)
             || jsonb_build_object(
                  '_meta',
                  COALESCE(buildings.raw_data->'_meta', '{}'::jsonb)
                  || jsonb_build_object($7::text, NOW()::text)
                )
           ),
           last_fetched_at = NOW()`,
    [
      bbl,
      meta.address ?? '',
      meta.borough ?? '',
      initialJson,
      key,
      JSON.stringify(rows),
      fetchedAtKey,
    ],
  );
}
