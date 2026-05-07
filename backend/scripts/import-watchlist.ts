/**
 * Phase 3.5 — Worst Landlord Watchlist import.
 *
 * Downloads the Public Advocate's watchlist CSV and matches it against
 * registered landlords in the database. Updates watchlist_rank on matches.
 *
 * Run:
 *   npm run import:watchlist
 *   npm run import:watchlist:dry-run
 *
 * The watchlist CSV format expected: two columns, comma-separated.
 *   rank,owner_name
 *   1,"CROMAN, STEVEN REALTY CORP"
 *   2,VANTAGE PROPERTIES LLC
 */

import 'dotenv/config';
import { getPool } from '../src/db/client.js';
import { matchByNormalized, type WatchlistRow } from '../src/landlord/watchlist-match.js';

const WATCHLIST_URL =
  process.env.WORST_LANDLORD_WATCHLIST_URL ??
  'https://landlordwatchlist.com/data/2025-watchlist.csv';

const dryRun = process.argv.includes('--dry-run');

function parseCsv(csv: string): Array<Record<string, string>> {
  const lines = csv.split('\n').filter((l) => l.trim());
  if (lines.length === 0) return [];
  const header = lines[0]!;
  const cols = header.split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map((line) => {
    // Handle quoted fields with commas inside
    const vals: string[] = [];
    let inQuote = false;
    let cur = '';
    for (const ch of line) {
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        vals.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    vals.push(cur.trim());
    return Object.fromEntries(cols.map((c, i) => [c, (vals[i] ?? '').replace(/^"|"$/g, '')]));
  });
}

async function main(): Promise<void> {
  console.log(`\nWatchlist importer — URL: ${WATCHLIST_URL}${dryRun ? ' [DRY RUN]' : ''}\n`);

  const res = await fetch(WATCHLIST_URL, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Watchlist fetch failed: HTTP ${res.status}`);
  const csv = await res.text();
  const rows = parseCsv(csv);

  const watchlist: WatchlistRow[] = rows
    .map((r) => ({ rank: Number(r['rank']), ownerName: r['owner_name'] ?? '' }))
    .filter((r) => r.rank > 0 && r.ownerName);

  const pool = getPool();
  const landlordRes = await pool.query<{ id: string; registered_owner_name: string | null }>(
    'SELECT id, registered_owner_name FROM landlords',
  );
  const all = landlordRes.rows;
  const matches = matchByNormalized(watchlist, all.map((r) => ({ id: r.id, registeredOwnerName: r.registered_owner_name })));

  console.log(`watchlist=${watchlist.length} landlords=${all.length} matched=${matches.length}`);

  if (dryRun) {
    console.log('[dry-run] would update:', matches.slice(0, 10));
    return;
  }

  let changed = 0;
  for (const m of matches) {
    const result = await pool.query(
      `UPDATE landlords SET watchlist_rank = $1
       WHERE id = $2 AND coalesce(watchlist_rank, -1) <> $1
       RETURNING id`,
      [m.rank, m.landlord_id],
    );
    if ((result.rowCount ?? 0) > 0) changed++;
  }
  console.log(`updated=${changed} (others already at correct rank)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
