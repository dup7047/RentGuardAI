// Phase 7: address autocomplete client.
// Hits the NYC Planning Labs Geosearch autocomplete endpoint directly from
// the browser. The endpoint is open-CORS, requires no auth, and is the
// same provider the backend uses for /v2/search during full lookups —
// so a suggestion picked here will resolve to the same BBL on the server.

type GeoFeature = {
  properties: {
    label: string;
    housenumber?: string;
    street?: string;
    borough?: string;
    neighbourhood?: string;
    addendum?: { pad?: { bbl?: string } };
  };
};
type GeoResponse = { features: GeoFeature[] };

export type AddressSuggestion = {
  /** NYC PAD BBL — guaranteed present (we drop features without one). */
  bbl: string;
  /**
   * What we set into the search input on pick. Title-cased
   * "350 5 Avenue, Park Slope, Brooklyn" — the backend's geosearch accepts
   * this format and resolves it to the same BBL.
   */
  display: string;
  /** First line in the dropdown — title-cased "350 5 Avenue". */
  primary: string;
  /** Second line in the dropdown — "Park Slope, Brooklyn" or just "Brooklyn". */
  secondary: string;
};

const ENDPOINT = 'https://geosearch.planninglabs.nyc/v2/autocomplete';
const SIZE = 6;
const CACHE_LIMIT = 16;

// Module-level LRU cache. Map preserves insertion order, so the oldest key
// is always cache.keys().next().value.
const cache = new Map<string, AddressSuggestion[]>();

/** Title-case helper: lower-case then capitalize each word boundary. */
function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function toSuggestion(f: GeoFeature): AddressSuggestion | null {
  const bbl = f.properties.addendum?.pad?.bbl;
  if (!bbl) return null;
  const housenumber = f.properties.housenumber ?? '';
  const street = f.properties.street ?? '';
  const borough = f.properties.borough ?? '';
  const neighbourhood = f.properties.neighbourhood ?? '';

  // Primary: title-cased "<housenumber> <street>". If either is missing
  // (rare for autocomplete results), fall back to the verbatim label.
  const rawPrimary = housenumber && street ? `${housenumber} ${street}` : f.properties.label;
  const primary = titleCase(rawPrimary);

  const secondary = neighbourhood ? `${neighbourhood}, ${borough}` : borough;
  const display = secondary ? `${primary}, ${secondary}` : primary;

  return { bbl, display, primary, secondary };
}

/**
 * Fetch up to 6 NYC address suggestions matching `text`.
 *
 * Abort contract: if the caller's `signal` aborts the fetch, this function
 * RE-THROWS the AbortError. Callers should catch and ignore. For all other
 * errors (network, JSON parse, schema mismatch) the function returns `[]`
 * silently — the dropdown just shows nothing.
 */
export async function getAddressSuggestions(
  text: string,
  signal?: AbortSignal,
): Promise<AddressSuggestion[]> {
  const key = text.trim().toLowerCase();
  if (!key) return [];

  const cached = cache.get(key);
  if (cached) {
    // Refresh recency (delete + re-set moves it to the end).
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  const url = `${ENDPOINT}?text=${encodeURIComponent(text.trim())}&size=${SIZE}`;
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return [];
  }
  if (!res.ok) return [];

  let data: GeoResponse;
  try {
    data = (await res.json()) as GeoResponse;
  } catch {
    return [];
  }

  const features = Array.isArray(data?.features) ? data.features : [];
  const suggestions = features
    .map(toSuggestion)
    .filter((s): s is AddressSuggestion => s !== null);

  // Insert into LRU; evict the oldest if we're over capacity.
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, suggestions);

  return suggestions;
}

/** Test-only: clear the in-memory cache between tests. */
export function __clearGeosearchCache(): void {
  cache.clear();
}
