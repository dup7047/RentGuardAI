/**
 * Select the top 100 cached buildings by open HPD violation count.
 *
 * Output: backend/scripts/top-100-bbls.txt (one BBL per line) + stdout.
 *
 * Open count is computed from raw_data->hpd_violations where currentstatus is
 * not 'CLOSE' (mirrors the live route at src/routes/building-by-bbl.ts).
 */

import { config as loadDotenv } from 'dotenv';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

loadDotenv();

import { getPool } from '../src/db/client.js';

async function main() {
  const pool = getPool();
  const { rows } = await pool.query<{ bbl: string; open_count: string }>(`
    SELECT
      bbl,
      (
        SELECT count(*)
        FROM jsonb_array_elements(raw_data->'hpd_violations') AS v
        WHERE v->>'currentstatus' IS DISTINCT FROM 'CLOSE'
      )::text AS open_count
    FROM buildings
    WHERE last_fetched_at IS NOT NULL
      AND jsonb_typeof(raw_data->'hpd_violations') = 'array'
    ORDER BY (
      SELECT count(*)
      FROM jsonb_array_elements(raw_data->'hpd_violations') AS v
      WHERE v->>'currentstatus' IS DISTINCT FROM 'CLOSE'
    ) DESC NULLS LAST
    LIMIT 100
  `);

  const bbls = rows.map((r) => r.bbl);
  const outPath = resolve(
    fileURLToPath(new URL('.', import.meta.url)),
    'top-100-bbls.txt',
  );
  writeFileSync(outPath, bbls.join('\n') + (bbls.length ? '\n' : ''), 'utf8');

  for (const r of rows) {
    console.log(`${r.bbl}\t${r.open_count}`);
  }
  console.error(`\nWrote ${bbls.length} BBLs to ${outPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
