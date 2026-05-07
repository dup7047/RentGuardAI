// Zillow extractor.
//
// Zillow ships full property data in <script id="__NEXT_DATA__">. The shape is
// stable enough that we look for the property object at:
//   props.pageProps.componentProps.gdpClientCache → JSON-stringified inner cache
//   OR props.pageProps.initialReduxState.gdp.building
//   OR (rental) props.pageProps.searchPageState.cat1.searchResults.listResults
//
// When the __NEXT_DATA__ shape doesn't match, fall back to JSON-LD parsing.
// The generic extractor catches sites without either.

import { logger } from '../../logger.js';
import type { ScrapedListing, ListingSourceKind } from '../types.js';
import { DESCRIPTION_STORAGE_CAP_CHARS } from '../types.js';

const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/;
const JSON_LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

export function matchZillow(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return host === 'zillow.com' || host.endsWith('.zillow.com');
}

function detectKind(url: string): ListingSourceKind {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (/^\/b\/\d+/.test(path)) return 'building';
    if (/\/homedetails\//.test(path)) return 'rental'; // Zillow doesn't always distinguish; treat as rental for our purposes
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

function findPropertyData(nextData: unknown): Record<string, unknown> | null {
  // Walk a few well-known paths Zillow uses for property data.
  // Wrap each in try/catch since the shape changes across versions.
  try {
    const root = nextData as { props?: { pageProps?: Record<string, unknown> } };
    const pp = root?.props?.pageProps;
    if (!pp) return null;

    // Path 1: gdpClientCache is a JSON-encoded inner cache
    const gdp = pp.gdpClientCache;
    if (typeof gdp === 'string' && gdp.startsWith('{')) {
      const parsed = JSON.parse(gdp) as Record<string, unknown>;
      // The cache is keyed by query hash; values are { property: {...} }
      for (const v of Object.values(parsed)) {
        if (v && typeof v === 'object' && 'property' in (v as Record<string, unknown>)) {
          const property = (v as { property?: unknown }).property;
          if (property && typeof property === 'object') return property as Record<string, unknown>;
        }
      }
    }

    // Path 2: componentProps.property (older shape)
    const cp = pp.componentProps;
    if (cp && typeof cp === 'object') {
      const property = (cp as Record<string, unknown>).property;
      if (property && typeof property === 'object') return property as Record<string, unknown>;
    }

    // Path 3: initialReduxState.gdp.building (building pages)
    const irs = pp.initialReduxState as { gdp?: { building?: unknown } } | undefined;
    if (irs?.gdp?.building && typeof irs.gdp.building === 'object') {
      return irs.gdp.building as Record<string, unknown>;
    }
  } catch (e) {
    logger.warn({ err: String(e) }, 'Zillow __NEXT_DATA__ walk failed');
  }
  return null;
}

function capDescription(s: string | null): string | null {
  if (!s) return null;
  return s.length > DESCRIPTION_STORAGE_CAP_CHARS
    ? s.slice(0, DESCRIPTION_STORAGE_CAP_CHARS)
    : s;
}

export function extractZillow(html: string, url: string): ScrapedListing | null {
  const kind = detectKind(url);
  let property: Record<string, unknown> | null = null;

  // Try __NEXT_DATA__ first (richest data)
  const nm = html.match(NEXT_DATA_RE);
  if (nm) {
    try {
      const nd = JSON.parse(nm[1]!);
      property = findPropertyData(nd);
    } catch (e) {
      logger.warn({ err: String(e) }, 'Zillow __NEXT_DATA__ parse failed');
    }
  }

  // Fallback: JSON-LD (less data but works on more pages)
  let jsonLdProperty: Record<string, unknown> | null = null;
  if (!property) {
    for (const m of html.matchAll(JSON_LD_RE)) {
      try {
        const parsed = JSON.parse(m[1]!) as Record<string, unknown>;
        if (
          parsed['@type'] === 'Apartment' ||
          parsed['@type'] === 'SingleFamilyResidence' ||
          parsed['@type'] === 'House' ||
          parsed['@type'] === 'Residence'
        ) {
          jsonLdProperty = parsed;
          break;
        }
      } catch {
        /* ignore malformed blocks */
      }
    }
  }

  // Address
  let address: string | null = null;
  let unit: string | null = null;
  if (property) {
    const addr = property.address as Record<string, unknown> | undefined;
    const street = pickString(addr, 'streetAddress');
    const city = pickString(addr, 'city');
    const state = pickString(addr, 'state');
    const zip = pickString(addr, 'zipcode', 'postalCode');
    if (street) address = [street, city, state, zip].filter(Boolean).join(', ');
    const u = pickString(property, 'unit', 'unitNumber');
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
  if (!address) {
    const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
    if (og) address = og[1]!.replace(/\s+\|\s+Zillow\s*$/i, '');
  }
  if (!address) {
    logger.warn({ url }, 'Zillow extractor: no address found');
    return null;
  }

  // Price (Zillow ships in dollars; convert to cents)
  let monthlyRentCents: number | null = null;
  if (property) {
    const price = pickNumber(property, 'price', 'listPrice');
    if (price && price > 0 && price < 100_000) monthlyRentCents = Math.round(price * 100);
  }

  // Beds / baths / sqft
  const bedrooms = property
    ? pickNumber(property, 'bedrooms', 'beds')
    : jsonLdProperty
      ? pickNumber(jsonLdProperty, 'numberOfBedrooms')
      : null;
  const bathrooms = property
    ? pickNumber(property, 'bathrooms', 'baths')
    : jsonLdProperty
      ? pickNumber(jsonLdProperty, 'numberOfBathroomsTotal', 'numberOfBathrooms')
      : null;
  const squareFeet = property
    ? pickNumber(property, 'livingArea', 'livingAreaValue')
    : null;

  // Description
  const description: string | null = property
    ? pickString(property, 'description')
    : jsonLdProperty
      ? pickString(jsonLdProperty, 'description')
      : null;

  const confidence: 'high' | 'medium' | 'low' =
    address && monthlyRentCents && bedrooms != null
      ? 'high'
      : address
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
    brokerFeeStated: 'unknown', // Zillow doesn't have a NYC broker-fee field; description-based detection lives in summary.ts
    brokerFeeText: null,
    securityDepositText: null,
    leaseTermMonths: null,
    petsPolicy: null,
    utilitiesIncluded: [],
    amenities: [],
    availabilityDate: null,
    description: capDescription(description),
    title: null,
    daysOnMarket: null,
    agentName: null,
    brokerage: null,
    confidence,
  };
}
