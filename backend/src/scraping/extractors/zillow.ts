// Zillow extractor.
//
// Zillow's data lives in three places (in this priority order):
//
//   1. JSON-LD `@type: ["RealEstateListing", "Product"]` script tag
//      Has price, address, image — most reliable structured data.
//
//   2. `gdpClientCache` — a JSON-encoded inner cache embedded as an escaped
//      string deep in another <script> tag (NOT in <script id="__NEXT_DATA__">,
//      which is the React-runtime hydration script and is mostly empty for us).
//      Has the full property: bedrooms, bathrooms, sqft, description, etc.
//
//   3. og:title + og:description meta tags — fallback when JSON+state aren't
//      reachable. og:description on Zillow is FORMATTED ("This is a X
//      bedroom, Y bathroom, Apartment home..."), so we regex-extract from it.
//
// If after ALL THREE we have only an address (no price, no bedroom count, no
// description), we return null — the user gets the manual paste fallback
// instead of a half-empty card.

import { logger } from '../../logger.js';
import type { ScrapedListing, ListingSourceKind } from '../types.js';
import { DESCRIPTION_STORAGE_CAP_CHARS } from '../types.js';

const JSON_LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
// Zillow embeds gdpClientCache inside an outer JSON string, so the inner JSON
// is backslash-escaped. Match the BACKSLASH-ESCAPED form.
const GDP_CLIENT_CACHE_RE = /\\"gdpClientCache\\":\\"(\{(?:\\.|[^"\\])*?\})\\"/;

export function matchZillow(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return host === 'zillow.com' || host.endsWith('.zillow.com');
}

function detectKind(url: string): ListingSourceKind {
  try {
    const u = new URL(url);
    const path = u.pathname;
    // Building pages: `/b/<digits>...` (older format) and `/b/<address-slug>-<base62-id>/`
    // (newer format like /b/149-starr-st-brooklyn-ny-3ryQ/). Both are aggregate
    // pages — no unit-specific listing data.
    if (/^\/b\//.test(path)) return 'building';
    if (/\/homedetails\//.test(path)) return 'rental';
    if (/\/apartments\//.test(path)) return 'rental';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

function pickString(obj: unknown, ...keys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

function pickNumber(obj: unknown, ...keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Returns true if the JSON-LD `@type` matches any accepted real-estate type.
 * Zillow uses `@type: ["RealEstateListing", "Product"]` (array). Older patterns
 * use the singular form. We accept both.
 */
function matchesRealEstateType(t: unknown): boolean {
  const accepted = new Set([
    'Apartment',
    'ApartmentComplex',
    'SingleFamilyResidence',
    'House',
    'Residence',
    'RealEstateListing',
    'Product',
  ]);
  if (typeof t === 'string') return accepted.has(t);
  if (Array.isArray(t)) return t.some((x) => typeof x === 'string' && accepted.has(x));
  return false;
}

/**
 * Pull property data out of Zillow's gdpClientCache escaped-JSON string.
 * The cache is a map keyed by query hash (e.g. "ForRentShopperPlatformFullRenderQuery{...}"),
 * with values shaped like `{property: {...}}`.
 */
function extractGdpProperty(html: string): Record<string, unknown> | null {
  const m = html.match(GDP_CLIENT_CACHE_RE);
  if (!m) return null;
  const escaped = m[1]!;
  // Unescape: \\" → "  and  \\\\ → \\
  const unescaped = escaped.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  try {
    const parsed = JSON.parse(unescaped) as Record<string, unknown>;
    for (const v of Object.values(parsed)) {
      if (v && typeof v === 'object' && 'property' in (v as Record<string, unknown>)) {
        const property = (v as { property?: unknown }).property;
        if (property && typeof property === 'object') return property as Record<string, unknown>;
      }
    }
  } catch (e) {
    logger.warn({ err: String(e) }, 'Zillow gdpClientCache JSON parse failed');
  }
  return null;
}

/**
 * Parse "X bedroom" / "Y bathroom" out of og:description as a last-resort
 * source for layout when no JSON-LD or gdpClientCache is reachable.
 * Examples Zillow ships:
 *   "This is a 0 bedroom, 1 bathroom, Apartment home."
 *   "This is a 2 bedroom, 1.5 bathroom, Apartment home."
 */
function parseLayoutFromDescription(desc: string): { beds: number | null; baths: number | null } {
  const bedMatch = desc.match(/(\d+(?:\.\d+)?)\s+bedroom/i);
  const bathMatch = desc.match(/(\d+(?:\.\d+)?)\s+bathroom/i);
  return {
    beds: bedMatch ? parseFloat(bedMatch[1]!) : null,
    baths: bathMatch ? parseFloat(bathMatch[1]!) : null,
  };
}

function capDescription(s: string | null): string | null {
  if (!s) return null;
  return s.length > DESCRIPTION_STORAGE_CAP_CHARS
    ? s.slice(0, DESCRIPTION_STORAGE_CAP_CHARS)
    : s;
}

export function extractZillow(html: string, url: string): ScrapedListing | null {
  const kind = detectKind(url);

  // 1. JSON-LD (handles array @type)
  let jsonLdProperty: Record<string, unknown> | null = null;
  for (const m of html.matchAll(JSON_LD_RE)) {
    try {
      const parsed = JSON.parse(m[1]!) as Record<string, unknown>;
      if (matchesRealEstateType(parsed['@type'])) {
        jsonLdProperty = parsed;
        break;
      }
      const graph = parsed['@graph'];
      if (Array.isArray(graph)) {
        for (const node of graph) {
          if (node && typeof node === 'object' && matchesRealEstateType((node as Record<string, unknown>)['@type'])) {
            jsonLdProperty = node as Record<string, unknown>;
            break;
          }
        }
        if (jsonLdProperty) break;
      }
    } catch {
      /* malformed JSON-LD blocks happen; ignore */
    }
  }

  // 2. gdpClientCache (richer; has bedrooms/bathrooms/sqft/description)
  const gdpProperty = extractGdpProperty(html);

  // 3. og meta — fallback for everything
  const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
  const ogDescription = html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/);
  const ogTitleText = ogTitle ? ogTitle[1]!.replace(/\s+\|\s+Zillow\s*$/i, '') : null;
  const ogDescriptionText = ogDescription ? ogDescription[1]! : null;

  // ── Address ─────────────────────────────────────────────────────────────────
  let address: string | null = null;
  let unit: string | null = null;
  if (gdpProperty) {
    const addr = gdpProperty.address as Record<string, unknown> | undefined;
    const street = pickString(addr, 'streetAddress');
    const city = pickString(addr, 'city');
    const state = pickString(addr, 'state');
    const zip = pickString(addr, 'zipcode', 'postalCode');
    if (street) address = [street, city, state, zip].filter(Boolean).join(', ');
    const u = pickString(gdpProperty, 'unit', 'unitNumber');
    if (u) unit = u;
  }
  if (!address && jsonLdProperty) {
    const addr = jsonLdProperty.address as Record<string, unknown> | undefined;
    const street = pickString(addr, 'streetAddress');
    const city = pickString(addr, 'addressLocality');
    const state = pickString(addr, 'addressRegion');
    const zip = pickString(addr, 'postalCode');
    if (street) address = [street, city, state, zip].filter(Boolean).join(', ');
  }
  if (!address && ogTitleText) address = ogTitleText;
  if (!address) {
    logger.warn({ url }, 'Zillow extractor: no address found');
    return null;
  }

  // ── Price ───────────────────────────────────────────────────────────────────
  let monthlyRentCents: number | null = null;
  if (gdpProperty) {
    const price = pickNumber(gdpProperty, 'price', 'listPrice');
    if (price != null && price > 0 && price < 100_000) monthlyRentCents = Math.round(price * 100);
  }
  if (monthlyRentCents == null && jsonLdProperty) {
    // JSON-LD on Zillow has price either at top level or under offers/priceSpecification
    const direct = pickNumber(jsonLdProperty, 'price');
    if (direct != null && direct > 0 && direct < 100_000) monthlyRentCents = Math.round(direct * 100);
    if (monthlyRentCents == null) {
      const offers = jsonLdProperty.offers as Record<string, unknown> | undefined;
      const offerPrice = pickNumber(offers, 'price');
      if (offerPrice != null && offerPrice > 0 && offerPrice < 100_000) {
        monthlyRentCents = Math.round(offerPrice * 100);
      }
    }
  }

  // ── Layout (beds / baths / sqft) ───────────────────────────────────────────
  let bedrooms = pickNumber(gdpProperty, 'bedrooms', 'beds');
  let bathrooms = pickNumber(gdpProperty, 'bathrooms', 'baths');
  const squareFeet = pickNumber(gdpProperty, 'livingArea', 'livingAreaValue');
  if (bedrooms == null && jsonLdProperty) {
    bedrooms = pickNumber(jsonLdProperty, 'numberOfBedrooms');
  }
  if (bathrooms == null && jsonLdProperty) {
    bathrooms = pickNumber(jsonLdProperty, 'numberOfBathroomsTotal', 'numberOfBathrooms');
  }
  // og:description fallback ("This is a 0 bedroom, 1 bathroom, Apartment home")
  if ((bedrooms == null || bathrooms == null) && ogDescriptionText) {
    const layout = parseLayoutFromDescription(ogDescriptionText);
    if (bedrooms == null) bedrooms = layout.beds;
    if (bathrooms == null) bathrooms = layout.baths;
  }

  // ── Description ─────────────────────────────────────────────────────────────
  // gdpClientCache.description is the listing-specific copy (best). Fall back
  // to JSON-LD description, then og:description (lowest signal — Zillow often
  // serves a generic boilerplate tagline here).
  let description: string | null = pickString(gdpProperty, 'description');
  let descriptionIsListingSpecific = description != null;
  if (!description) {
    description = pickString(jsonLdProperty, 'description');
    if (description) descriptionIsListingSpecific = true;
  }
  if (!description && ogDescriptionText) {
    description = ogDescriptionText;
    // og:description could be the listing OR a generic tagline. Only count as
    // listing-specific if it explicitly mentions property attributes.
    descriptionIsListingSpecific =
      /\d+\s+(bedroom|bathroom)/i.test(ogDescriptionText) ||
      /\$\d/.test(ogDescriptionText) ||
      /\/mo|per month/i.test(ogDescriptionText);
  }

  // ── Confidence ──────────────────────────────────────────────────────────────
  // For unit-level URLs (/homedetails/, /apartments/) we refuse to surface a
  // "scraped listing" with literally nothing in it — the user is asking about
  // a specific apartment, and an empty card would be misleading. Require at
  // least ONE of: rent, bedroom count, listing-specific description.
  //
  // Building-level URLs (/b/<slug>/) are different by design: they're
  // aggregate pages with no per-unit data. Accepting address-only here lets
  // the lookup pipeline continue with a normal building report instead of
  // surfacing the "listing blocked" UI for a page that wasn't blocked at all.
  const hasRichData =
    monthlyRentCents != null || bedrooms != null || descriptionIsListingSpecific;
  if (!hasRichData && kind !== 'building') {
    logger.info(
      { url, addressFromOg: address },
      'Zillow extractor: only address found, no rent/beds/listing-specific description — treating as blocked',
    );
    return null;
  }

  const confidence: 'high' | 'medium' | 'low' =
    address && monthlyRentCents != null && bedrooms != null
      ? 'high'
      : address && (monthlyRentCents != null || description)
        ? 'medium'
        : 'low';

  return {
    url,
    source: 'zillow',
    source_kind: kind,
    fetchedAt: new Date().toISOString(),
    address,
    unit,
    monthlyRentCents,
    bedrooms,
    bathrooms,
    squareFeet,
    brokerFeeStated: 'unknown',
    brokerFeeText: null,
    securityDepositText: null,
    leaseTermMonths: null,
    petsPolicy: null,
    utilitiesIncluded: [],
    amenities: [],
    availabilityDate: null,
    description: capDescription(description),
    title: ogTitleText,
    daysOnMarket: null,
    agentName: null,
    brokerage: null,
    confidence,
  };
}
