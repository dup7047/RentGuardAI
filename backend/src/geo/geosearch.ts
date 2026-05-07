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
    addendum?: {
      pad?: { bbl?: string };
    };
  };
};

type GeoResponse = { features: GeoFeature[] };

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

  const normalized = normalize(trimmed);
  const url = `https://geosearch.planninglabs.nyc/v2/search?text=${encodeURIComponent(normalized)}&size=5&layers=address`;

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    logger.warn({ err: String(e) }, 'GeoSearch unavailable');
    throw new GeocodeError('unavailable', 'geosearch unavailable');
  }

  if (!res.ok) {
    throw new GeocodeError('unavailable', `geosearch ${res.status}`);
  }

  const json = (await res.json()) as GeoResponse;
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

  const top = feats[0]!;
  const bbl = top.properties.addendum?.pad?.bbl;
  const conf = top.properties.confidence ?? 0;
  const borough = (top.properties.borough?.toUpperCase() ?? 'MANHATTAN') as Borough;

  // Multiple distinct BBLs → ambiguous
  const distinctBbls = new Set(
    feats.map((f) => f.properties.addendum?.pad?.bbl).filter(Boolean),
  );
  if (distinctBbls.size > 1) {
    return {
      kind: 'ambiguous',
      matches: feats
        .filter((f) => f.properties.addendum?.pad?.bbl)
        .map((f) => ({
          bbl: f.properties.addendum!.pad!.bbl!,
          address: f.properties.label ?? '',
          borough: (f.properties.borough?.toUpperCase() ?? 'MANHATTAN') as Borough,
        })),
    };
  }

  // Single result with a BBL
  if (bbl) {
    return {
      kind: 'matched',
      bbl,
      address: top.properties.label ?? trimmed,
      borough,
      confidence: conf,
    };
  }

  // No BBL in any result → outside_nyc
  const det = tryDetectOutsideNyc(trimmed);
  return {
    kind: 'outside_nyc',
    detected_city: det.city,
    detected_state: det.state,
    raw_input: trimmed,
  };
}
