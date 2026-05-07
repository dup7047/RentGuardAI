// Pure matching utilities for the Worst Landlord Watchlist.
// No DB or network calls — all I/O lives in scripts/import-watchlist.ts.

const STRIP_SUFFIX = /\b(LLC|L\.L\.C\.|INC\.?|CORP\.?|CORPORATION|LTD\.?|LP|LIMITED)\b/gi;
const STRIP_PUNCT = /[.,'&]/g;

/**
 * Normalize an owner name for fuzzy matching:
 *   - Uppercase
 *   - Strip legal entity suffixes (LLC, Inc., Corp, etc.)
 *   - Strip punctuation
 *   - Collapse whitespace
 */
export function normalizeOwner(name: string): string {
  return name
    .toUpperCase()
    .replace(STRIP_SUFFIX, '')
    .replace(STRIP_PUNCT, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type WatchlistRow = { rank: number; ownerName: string };
export type LandlordRow = { id: string; registeredOwnerName: string | null };

/**
 * Match watchlist entries against known landlords by normalized owner name.
 * Returns pairs of { landlord_id, rank } for all matches found.
 */
export function matchByNormalized(
  watchlist: WatchlistRow[],
  landlordRows: LandlordRow[],
): Array<{ landlord_id: string; rank: number }> {
  const map = new Map<string, number>();
  for (const w of watchlist) {
    map.set(normalizeOwner(w.ownerName), w.rank);
  }

  const out: Array<{ landlord_id: string; rank: number }> = [];
  for (const l of landlordRows) {
    if (!l.registeredOwnerName) continue;
    const rank = map.get(normalizeOwner(l.registeredOwnerName));
    if (rank !== undefined) {
      out.push({ landlord_id: l.id, rank });
    }
  }
  return out;
}
