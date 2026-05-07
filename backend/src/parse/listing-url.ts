// Pure URL parser — no network calls.
// Extracts address strings from StreetEasy, Zillow, and Apartments.com listing URLs.

import { ListingParseError, type ListingParseResult } from './listing-url.types.js';

/** Convert a URL slug to an address string.
 *  Drops trailing unit suffixes like `_3a`, `_apt4b`, converts hyphens/underscores to spaces.
 *  Only drops the trailing _<suffix> when the suffix starts with a digit (unit numbers).
 *  Pure alpha suffixes like `_york` (part of "new_york") are kept as spaces. */
const slugToAddress = (slug: string): string =>
  slug
    .replace(/_\d[a-z0-9]*$/i, '') // drop _<digit>... unit suffix only (e.g. _3a, _4f)
    .replace(/[-_]/g, ' ')         // hyphens and remaining underscores → spaces
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Parse a real-estate listing URL to extract an address string.
 *
 * Supports:
 *   StreetEasy  /building/<slug>  and  /rental/<id>/<slug>
 *   Zillow      /homedetails/<slug>/<zpid>_zpid/
 *   Apartments  /<slug-with-ny|nj>/<id>/
 *
 * @throws ListingParseError('invalid_url') if rawUrl is not a valid URL
 * @returns ListingParseResult — either address_extracted or requires_address
 */
export function parseListingUrl(rawUrl: string): ListingParseResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ListingParseError('invalid_url');
  }

  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname;

  // StreetEasy: /building/<slug> or /rental/<id>/<slug>
  if (host === 'streeteasy.com') {
    // /building/<slug> — slug must start with a digit to be an address
    let m = path.match(/^\/building\/([a-z0-9_-]+)\/?$/i);
    if (m && m[1]) {
      const slug = m[1];
      if (/^\d/.test(slug)) {
        return { kind: 'address_extracted', address: slugToAddress(slug), host: 'streeteasy' };
      }
      return { kind: 'requires_address', reason: 'opaque_id' };
    }

    // /rental/<id>/<slug> or /sale/<id>/<slug>
    m = path.match(/^\/(?:rental|sale)\/\d+\/([a-z0-9_-]+)\/?$/i);
    if (m && m[1]) {
      return { kind: 'address_extracted', address: slugToAddress(m[1]), host: 'streeteasy' };
    }

    return { kind: 'requires_address', reason: 'opaque_id' };
  }

  // Zillow: /homedetails/<slug>/<zpid>_zpid/
  if (host === 'zillow.com') {
    const m = path.match(/^\/homedetails\/([a-z0-9-]+)\/\d+_zpid\/?$/i);
    if (m && m[1]) {
      return { kind: 'address_extracted', address: slugToAddress(m[1]), host: 'zillow' };
    }
    return { kind: 'requires_address', reason: 'opaque_id' };
  }

  // Apartments.com: /<slug-ending-in-ny|nj>/<id>/
  if (host === 'apartments.com') {
    const m = path.match(/^\/([a-z0-9-]+-(?:ny|nj))\/\d+\/?$/i);
    if (m && m[1]) {
      return { kind: 'address_extracted', address: slugToAddress(m[1]), host: 'apartments' };
    }
    return { kind: 'requires_address', reason: 'opaque_id' };
  }

  return { kind: 'requires_address', reason: 'unknown_host' };
}
