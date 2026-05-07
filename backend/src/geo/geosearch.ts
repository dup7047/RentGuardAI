// NYC GeoSearch API wrapper: address string → BBL (or non-NYC signal).
// API: https://geosearch.planninglabs.nyc/v2/search

import { normalize } from './normalize.js';
import { GeocodeError, type GeocodeResult } from './types.js';
import type { Borough } from '../data/types.js';
import { logger } from '../logger.js';

// US state abbreviations (non-NYC) used to detect outside-NYC addresses.
const STATE_REGEX =
  /\b(?:WA|OR|CA|ID|NV|MT|UT|AZ|CO|WY|NM|TX|OK|KS|NE|SD|ND|MN|IA|MO|AR|LA|MS|AL|TN|KY|WV|VA|NC|SC|GA|FL|MD|DE|NJ|PA|OH|IN|IL|MI|WI|ME|NH|VT|MA|CT|RI|DC|HI|AK)\b/;

function tryDetectOutsideNyc(raw: string): { city: string | null; state: string | null } {
  const stateMatch = raw.toUpperCase().match(STATE_REGEX);
  if (!stateMatch) return { city: null, state: null };
  const state = stateMatch[0];
  const before = raw.toUpperCase().slice(0, stateMatch.index ?? 0).trim();
  const cityMatch = before.match(/(\b[A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)?)\s*$/);
  return { city: cityMatch?.[1] ?? null, state };
}

type GeoFeature = {
  properties: {
    confidence?: number;
    label?: string;
    borough?: string;
    /** Pelias-extracted street number, e.g. "350" or "350A" or "100-12". */
    housenumber?: string;
    addendum?: {
      pad?: { bbl?: string };
    };
  };
};

type GeoResponse = { features: GeoFeature[] };

/**
 * Strip housenumber down to its leading digit run (e.g., "350A" → "350",
 * "100-12" → "100"). Used to recognize when two features describe the same
 * physical address with letter/dash variants. Returns "" if the housenumber
 * is missing or doesn't start with a digit.
 */
function housenumberDigits(h: string | undefined): string {
  if (!h) return '';
  return h.match(/^\d+/)?.[0] ?? '';
}

/**
 * Geocode a user-supplied address string to a BBL using the NYC Planning
 * GeoSearch API. Returns a discriminated union:
 *   - matched: single high-confidence BBL found
 *   - ambiguous: multiple distinct BBLs returned
 *   - outside_nyc: no NYC result found (with detected city/state when possible)
 *
 * @throws GeocodeError('empty_input') if input is blank
 * @throws GeocodeError('unavailable') if the API is unreachable or returns an error
 */
export async function geosearch(input: string): Promise<GeocodeResult> {
  const trimmed = input.trim();
  if (!trimmed) throw new GeocodeError('empty_input', 'empty input');

  // Short-circuit: when the input contains a non-NYC state token (CA, TX, FL, etc.),
  // skip the GeoSearch API entirely. Pelias will fuzzy-match such inputs to weak
  // NYC results, which would then trigger expensive downstream work (datasets +
  // landlord + AI) for an address the user clearly didn't mean to look up.
  const earlyDet = tryDetectOutsideNyc(trimmed);
  if (earlyDet.state) {
    return {
      kind: 'outside_nyc',
      detected_city: earlyDet.city,
      detected_state: earlyDet.state,
      raw_input: trimmed,
    };
  }

  const normalized = normalize(trimmed);
  // Note: do NOT restrict by `layers=address`. Many well-known NYC buildings
  // (Empire State, Penn Station, etc.) come back as `layer=venue` and would
  // be filtered out, falling through to a false outside_nyc. We accept any
  // layer; non-NYC results are filtered by `addendum.pad.bbl` presence below.
  const url = `https://geosearch.planninglabs.nyc/v2/search?text=${encodeURIComponent(normalized)}&size=5`;

  const start = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    logger.warn({ err: String(e), durationMs: Date.now() - start }, 'GeoSearch unavailable');
    throw new GeocodeError('unavailable', 'geosearch unavailable');
  }

  if (!res.ok) {
    throw new GeocodeError('unavailable', `geosearch ${res.status}`);
  }

  const json = (await res.json()) as GeoResponse;
  logger.info(
    { status: res.status, durationMs: Date.now() - start, featureCount: json.features?.length ?? 0 },
    'geosearch completed',
  );
  const feats = json.features ?? [];

  if (feats.length === 0) {
    const det = tryDetectOutsideNyc(trimmed);
    return {
      kind: 'outside_nyc',
      detected_city: det.city,
      detected_state: det.state,
      raw_input: trimmed,
    };
  }

  // Filter to features whose housenumber matches the top result's housenumber
  // (compared by leading digits, so "350" / "350A" / "350B" are siblings but
  // "350" and "3501" are not). Without this filter, Pelias's fuzzy fillers
  // can outvote the exact match: e.g., a search for "3007 3rd Ave" returns
  // [3007 (1×), 2850 (1×), 2856 (1×)] where 2850 and 2856 share one BBL
  // (count 2 after dedup) and incorrectly dominate the actual exact-match
  // BBL of 3007.
  const firstWithBbl = feats.find((f) => f.properties.addendum?.pad?.bbl);
  const targetDigits = housenumberDigits(firstWithBbl?.properties.housenumber);
  const candidates = targetDigits
    ? feats.filter((f) => housenumberDigits(f.properties.housenumber) === targetDigits)
    : feats;

  // Group features by BBL — dedupe before deciding ambiguous.
  // Pelias often returns the same building multiple times (e.g. 350, 350A, 350B
  // all map to the same BBL) plus weak fuzzy matches in other boroughs.
  // Without dedupe, even a clean address comes back as ambiguous.
  const bblCounts = new Map<string, number>();
  const bblTopFeature = new Map<string, GeoFeature>();
  for (const f of candidates) {
    const b = f.properties.addendum?.pad?.bbl;
    if (!b) continue;
    bblCounts.set(b, (bblCounts.get(b) ?? 0) + 1);
    if (!bblTopFeature.has(b)) bblTopFeature.set(b, f);
  }

  // No BBL in any result → outside_nyc
  if (bblCounts.size === 0) {
    const det = tryDetectOutsideNyc(trimmed);
    return {
      kind: 'outside_nyc',
      detected_city: det.city,
      detected_state: det.state,
      raw_input: trimmed,
    };
  }

  // Single distinct BBL → matched, no question
  if (bblCounts.size === 1) {
    const bbl = bblCounts.keys().next().value as string;
    const top = bblTopFeature.get(bbl)!;
    return {
      kind: 'matched',
      bbl,
      address: top.properties.label ?? trimmed,
      borough: (top.properties.borough?.toUpperCase() ?? 'MANHATTAN') as Borough,
      confidence: top.properties.confidence ?? 0,
    };
  }

  // Multiple distinct BBLs — check if one is dominant (appears strictly more
  // often than every other). If so, treat as matched.
  const sortedBbls = [...bblCounts.entries()].sort((a, b) => b[1] - a[1]);
  const [topBbl, topCount] = sortedBbls[0]!;
  const [, secondCount] = sortedBbls[1] ?? ['', 0];
  if (topCount > secondCount) {
    const top = bblTopFeature.get(topBbl)!;
    return {
      kind: 'matched',
      bbl: topBbl,
      address: top.properties.label ?? trimmed,
      borough: (top.properties.borough?.toUpperCase() ?? 'MANHATTAN') as Borough,
      confidence: top.properties.confidence ?? 0,
    };
  }

  // Tie → genuinely ambiguous. Return deduplicated matches.
  return {
    kind: 'ambiguous',
    matches: [...bblCounts.keys()].map((b) => {
      const f = bblTopFeature.get(b)!;
      return {
        bbl: b,
        address: f.properties.label ?? '',
        borough: (f.properties.borough?.toUpperCase() ?? 'MANHATTAN') as Borough,
      };
    }),
  };
}
