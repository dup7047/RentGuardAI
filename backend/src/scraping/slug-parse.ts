// Best-effort building-address extraction from Zillow / StreetEasy URL slugs.
//
// When the live scraper fails (Firecrawl quota exhausted, bot-wall, etc.), we
// fall back to parsing the address straight out of the URL path. The user
// loses listing-specific fields (rent, beds, broker fee) but still gets a
// building report — same end state as the manual-paste fallback, with zero
// clicks. Returns null when the URL doesn't match a known shape; callers
// fall through to the existing error path.
//
// Pure functions: no IO, no logging. Validation against the geocoder happens
// downstream in `geosearch()`, which rejects anything that doesn't resolve
// to a real NYC building.

import type { ListingSource } from './types.js';

// NYC boroughs / city names as they appear in slugs (with hyphens for spaces).
// `New-York` matches both Manhattan addresses and the generic NYC label;
// boroughs cover specific-borough listings.
const ZILLOW_CITY_RE = /\b(?:New-York|Manhattan|Brooklyn|Bronx|Queens|Staten-Island)\b/i;
const STREETEASY_CITY_NORMALIZED = new Set([
  'new york',
  'manhattan',
  'brooklyn',
  'bronx',
  'queens',
  'staten island',
]);

export function parseAddressFromUrl(canonicalUrl: string, source: ListingSource): string | null {
  if (source === 'zillow') return parseZillowUrl(canonicalUrl);
  if (source === 'streeteasy') return parseStreetEasyUrl(canonicalUrl);
  return null;
}

/**
 * Zillow URL shapes we handle:
 *   /homedetails/<slug>/<zpid>_zpid/   — most common rental + sale
 *   /b/<slug>/(bb<id>)?                — building pages
 *
 * The slug carries `<housenumber>-<street>(-APT-<unit>)?-<city>-<state>-<zip>`.
 * We anchor on the trailing `-NY-<zip>` (or `-NY`) and walk back to find a
 * known NYC city token. Non-NY URLs return null so the geocoder doesn't
 * waste a round-trip on an out-of-state property.
 */
function parseZillowUrl(url: string): string | null {
  const rawSlug = extractZillowSlug(url);
  if (!rawSlug) return null;

  // /b/ building URLs end with a -bb<digits> ID after the state. /homedetails/
  // slugs don't carry an ID inside the slug itself (the zpid is a separate
  // path segment). Strip a trailing -bb<digits> defensively.
  const slug = rawSlug.replace(/-bb\d+$/i, '');

  // Trailing -NY-<zip> or -NY
  const zipMatch = slug.match(/^(.+?)-NY-(\d{5})$/i);
  const noZipMatch = !zipMatch ? slug.match(/^(.+?)-NY$/i) : null;
  if (!zipMatch && !noZipMatch) return null;

  const beforeState = (zipMatch ?? noZipMatch)![1]!;
  const zip = zipMatch ? zipMatch[2]! : null;

  let beforeCity: string;
  let cityRaw: string | null = null;

  // APT-aware split — when there's a -(APT|UNIT|#)-<unit> segment, treat that
  // as the address/city boundary. Lets us handle NYC neighborhoods that
  // aren't borough names (Ridgewood, Astoria, Williamsburg, Bushwick, etc.)
  // without enumerating them. Anything between the unit and the state suffix
  // is the city/neighborhood, passed straight to the geocoder.
  const aptSplit = beforeState.match(/^(.+?)-(?:APT|UNIT|#)-[A-Z0-9]+(?:-(.+))?$/i);
  if (aptSplit) {
    beforeCity = aptSplit[1]!;
    cityRaw = aptSplit[2] ?? null;
  } else {
    // No APT — fall back to the borough allowlist. URLs that hit this branch
    // and are in a non-borough neighborhood (rare without a unit) currently
    // return null and surface as listing_blocked.
    const cityMatch = beforeState.match(ZILLOW_CITY_RE);
    if (!cityMatch) return null;
    const cityIdx = beforeState.lastIndexOf(cityMatch[0]);
    beforeCity = beforeState.slice(0, cityIdx).replace(/-+$/, '');
    cityRaw = cityMatch[0];
  }

  const tokens = beforeCity.split('-').filter(Boolean);
  if (tokens.length < 2) return null;
  const housenumber = tokens[0]!;
  if (!/^\d{1,5}[A-Z]?$/i.test(housenumber)) return null;
  const street = tokens.slice(1).join(' ');
  if (!street) return null;

  const city = cityRaw ? cityRaw.replace(/-/g, ' ') : null;
  if (city && zip) return `${housenumber} ${street}, ${city}, NY ${zip}`;
  if (city) return `${housenumber} ${street}, ${city}, NY`;
  if (zip) return `${housenumber} ${street}, NY ${zip}`;
  return `${housenumber} ${street}, NY`;
}

function extractZillowSlug(url: string): string | null {
  const homeM = url.match(/\/homedetails\/([^/]+)/i);
  if (homeM) return homeM[1]!;
  const bldgM = url.match(/\/b\/([^/]+)/i);
  if (bldgM) return bldgM[1]!;
  return null;
}

/**
 * StreetEasy URL shape we handle:
 *   /building/<housenumber>-<street-words>-<city>
 *
 * The city token uses underscores for internal spaces (e.g. `new_york`,
 * `staten_island`). Listing IDs (`/rental/12345`, `/sale/67890`) carry no
 * address and return null.
 */
function parseStreetEasyUrl(url: string): string | null {
  const m = url.match(/\/building\/([^/?#]+)/i);
  if (!m) return null;
  const slug = m[1]!;

  const tokens = slug.split('-').filter(Boolean);
  if (tokens.length < 3) return null;

  const housenumber = tokens[0]!;
  if (!/^\d{1,5}[A-Z]?$/i.test(housenumber)) return null;

  const cityToken = tokens[tokens.length - 1]!;
  const cityNormalized = cityToken.replace(/_/g, ' ').toLowerCase();
  if (!STREETEASY_CITY_NORMALIZED.has(cityNormalized)) return null;
  const city = titleCase(cityNormalized);

  const streetTokens = tokens.slice(1, -1);
  if (streetTokens.length === 0) return null;
  const street = titleCase(streetTokens.join(' '));

  return `${housenumber} ${street}, ${city}, NY`;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
