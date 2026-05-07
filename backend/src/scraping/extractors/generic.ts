// Generic extractor — last-resort fallback for unknown listing hosts.
//
// Tries Open Graph meta + JSON-LD (typed Apartment/Residence/Place).
// `confidence: 'low'` is set on every result so downstream code knows the
// data is best-effort. Returns null if neither OG nor JSON-LD yields an
// address — fetcher then returns `error: 'unsupported_url'`.

import { logger } from '../../logger.js';
import type { ScrapedListing } from '../types.js';
import { DESCRIPTION_STORAGE_CAP_CHARS } from '../types.js';

const JSON_LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
const META_RE = /<meta[^>]+(?:property|name)=["']([^"']+)["'][^>]+content=["']([^"']+)["']/g;

const ACCEPTED_TYPES = new Set([
  'Apartment',
  'ApartmentComplex',
  'SingleFamilyResidence',
  'House',
  'Residence',
  'Place',
  'RealEstateListing',
  'RentAction',
]);

function readMeta(html: string): Map<string, string> {
  const meta = new Map<string, string>();
  for (const m of html.matchAll(META_RE)) {
    const key = m[1]!.toLowerCase();
    if (!meta.has(key)) meta.set(key, m[2]!);
  }
  return meta;
}

function findTypedJsonLd(html: string): Record<string, unknown> | null {
  for (const m of html.matchAll(JSON_LD_RE)) {
    try {
      const parsed = JSON.parse(m[1]!) as Record<string, unknown>;
      // Direct @type match
      if (typeof parsed['@type'] === 'string' && ACCEPTED_TYPES.has(parsed['@type'])) {
        return parsed;
      }
      // @graph[] member match
      const graph = parsed['@graph'];
      if (Array.isArray(graph)) {
        for (const node of graph) {
          if (
            node &&
            typeof node === 'object' &&
            typeof (node as Record<string, unknown>)['@type'] === 'string' &&
            ACCEPTED_TYPES.has((node as { '@type': string })['@type'])
          ) {
            return node as Record<string, unknown>;
          }
        }
      }
    } catch (e) {
      logger.warn({ err: String(e) }, 'generic: JSON-LD parse failed');
    }
  }
  return null;
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

function parsePriceToCents(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return Math.round(input * 100);
  if (typeof input !== 'string') return null;
  const m = input.match(/\$?\s*([\d,]+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const dollars = parseInt(m[1]!.replace(/,/g, ''), 10);
  const cents = m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0;
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  return dollars * 100 + cents;
}

function capDescription(s: string | null): string | null {
  if (!s) return null;
  return s.length > DESCRIPTION_STORAGE_CAP_CHARS
    ? s.slice(0, DESCRIPTION_STORAGE_CAP_CHARS)
    : s;
}

export function extractGeneric(html: string, url: string): ScrapedListing | null {
  const meta = readMeta(html);
  const ld = findTypedJsonLd(html);

  // Address: prefer JSON-LD streetAddress; fallback to og:title
  let address: string | null = null;
  if (ld) {
    const addr = ld.address as Record<string, unknown> | undefined;
    const street = pickString(addr, 'streetAddress');
    const city = pickString(addr, 'addressLocality');
    const state = pickString(addr, 'addressRegion');
    const zip = pickString(addr, 'postalCode');
    if (street) address = [street, city, state, zip].filter(Boolean).join(', ');
  }
  if (!address) {
    const ogTitle = meta.get('og:title');
    if (ogTitle && /\d/.test(ogTitle)) {
      // og:title with a digit is plausibly an address; otherwise reject
      address = ogTitle;
    }
  }

  // Price (rare in generic JSON-LD; check both `price` and `offers.price`)
  let monthlyRentCents: number | null = null;
  if (ld) {
    monthlyRentCents = parsePriceToCents(ld.price);
    if (monthlyRentCents == null) {
      const offers = ld.offers as Record<string, unknown> | undefined;
      monthlyRentCents = parsePriceToCents(offers?.price);
    }
  }
  // Sanity-check: ridiculously large numbers might be sale prices, not monthly rent
  if (monthlyRentCents != null && monthlyRentCents > 100_000_00) {
    monthlyRentCents = null; // > $100k/mo is almost certainly a misparse
  }

  // Description
  const description = ld ? pickString(ld, 'description') : meta.get('og:description') ?? null;
  const title = ld ? pickString(ld, 'name', 'title') : meta.get('og:title') ?? null;

  if (!address && !description) {
    logger.warn({ url }, 'generic extractor: insufficient data');
    return null;
  }

  return {
    url,
    source: 'generic',
    source_kind: 'unknown',
    fetchedAt: new Date().toISOString(),
    address,
    unit: null,
    monthlyRentCents,
    bedrooms: null,
    bathrooms: null,
    squareFeet: null,
    brokerFeeStated: 'unknown',
    brokerFeeText: null,
    securityDepositText: null,
    leaseTermMonths: null,
    petsPolicy: null,
    utilitiesIncluded: [],
    amenities: [],
    availabilityDate: null,
    description: capDescription(description),
    title,
    daysOnMarket: null,
    agentName: null,
    brokerage: null,
    confidence: 'low', // generic always low — caller can decide whether to accept
  };
}
