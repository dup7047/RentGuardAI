// StreetEasy extractor.
//
// StreetEasy embeds rich structured data in a single JSON-LD <script> block
// keyed by @graph. The Apartment node has:
//   - address.streetAddress  → full address with unit
//   - additionalProperty[]   → "Monthly Rent" with formatted value
//   - amenityFeature[]       → boolean LocationFeatureSpecification entries
//   - event[].description    → full listing description text
//   - event[].offers.price   → integer price in dollars
//   - event[].offers.validFrom → ISO availability date
//
// Plus the page embeds Next.js streaming data containing keys like
// "formattedBedrooms", "formattedBathrooms", "formattedPrice" — we
// parse these via regex for beds/baths counts (not in JSON-LD).

import { logger } from '../../logger.js';
import type { ScrapedListing, FareFee, ListingSourceKind } from '../types.js';
import { DESCRIPTION_STORAGE_CAP_CHARS } from '../types.js';

const JSON_LD_RE = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;

/** /building/<slug>/<unit> → rental, /building/<slug> → building, /sale/<id> → sale */
function detectKind(url: string): ListingSourceKind {
  try {
    const u = new URL(url);
    const path = u.pathname;
    if (/^\/sale\//.test(path)) return 'sale';
    if (/^\/building\/[^/]+\/[^/]+/.test(path)) return 'rental';
    if (/^\/building\/[^/]+\/?$/.test(path)) return 'building';
    if (/^\/rental\//.test(path)) return 'rental';
    return 'unknown';
  } catch {
    return 'unknown';
  }
}

type GraphNode = Record<string, unknown> & { '@type'?: string };

/** Walks @graph[] and returns the first node matching the predicate (deep). */
function findGraphNode(json: unknown, type: string): GraphNode | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as { '@graph'?: unknown[]; '@type'?: string };
  if (Array.isArray(obj['@graph'])) {
    for (const node of obj['@graph']) {
      if (node && typeof node === 'object') {
        const n = node as GraphNode;
        if (n['@type'] === type) return n;
      }
    }
  }
  if (obj['@type'] === type) return obj as GraphNode;
  return null;
}

/** Parse "$5,825/mo" or "$5825" → integer cents (582500). Returns null on failure. */
function parsePriceToCents(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return Math.round(input * 100);
  if (typeof input !== 'string') return null;
  const m = input.match(/\$\s*([\d,]+)(?:\.(\d{1,2}))?/);
  if (!m) return null;
  const dollars = parseInt(m[1]!.replace(/,/g, ''), 10);
  const cents = m[2] ? parseInt(m[2].padEnd(2, '0'), 10) : 0;
  if (!Number.isFinite(dollars)) return null;
  return dollars * 100 + cents;
}

function parseInteger(input: unknown): number | null {
  if (typeof input === 'number' && Number.isFinite(input)) return Math.round(input);
  if (typeof input !== 'string') return null;
  const m = input.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]!);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extract the value from "formattedXxx":"<value>" via regex.
 * StreetEasy embeds these in a Next.js streaming payload where the inner JSON
 * is backslash-escaped, so we accept BOTH:
 *   "formattedBedrooms":"2 beds"        (plain JSON)
 *   \"formattedBedrooms\":\"2 beds\"     (escaped inside an outer string)
 */
function findFormatted(html: string, key: string): string | null {
  const plain = html.match(new RegExp(`"${key}":"([^"]+)"`));
  if (plain) return plain[1]!;
  const escaped = html.match(new RegExp(`\\\\"${key}\\\\":\\\\"([^\\\\]+)\\\\"`));
  if (escaped) return escaped[1]!;
  return null;
}

/** Detect "no broker fee" language vs explicit fee mention. Conservative — defaults to 'unknown'. */
function detectBrokerFee(description: string | null): { stated: FareFee; text: string | null } {
  if (!description) return { stated: 'unknown', text: null };
  const d = description.toLowerCase();
  // Explicit "no fee" markers
  if (
    d.includes('no broker fee') ||
    d.includes('no-fee') ||
    d.includes('no fee unit') ||
    d.includes('no broker') && d.includes('fee')
  ) {
    return { stated: 'no_fee', text: extractSurroundingPhrase(description, /no(\s+|-)broker\s+fee/i) };
  }
  // Explicit fee
  if (
    d.includes('broker fee') &&
    (d.includes('one month') || d.includes('15%') || d.includes('12%') || d.includes('one (1) month'))
  ) {
    return { stated: 'fee', text: extractSurroundingPhrase(description, /broker\s+fee/i) };
  }
  return { stated: 'unknown', text: null };
}

function extractSurroundingPhrase(text: string, re: RegExp): string {
  const m = text.match(re);
  if (!m || m.index == null) return text.slice(0, 80);
  const start = Math.max(0, m.index - 20);
  const end = Math.min(text.length, m.index + m[0].length + 60);
  return text.slice(start, end).trim();
}

function capDescription(s: string | null): string | null {
  if (!s) return null;
  return s.length > DESCRIPTION_STORAGE_CAP_CHARS
    ? s.slice(0, DESCRIPTION_STORAGE_CAP_CHARS)
    : s;
}

/** Match URL belongs to StreetEasy. */
export function matchStreetEasy(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  return host === 'streeteasy.com' || host.endsWith('.streeteasy.com');
}

/**
 * Parse a StreetEasy page into a ScrapedListing. Returns null on hard failure
 * (no JSON-LD, no extractable address) so the fetcher can return
 * `unsupported_url` or fall back appropriately.
 */
export function extractStreetEasy(html: string, url: string): ScrapedListing | null {
  const kind = detectKind(url);

  // Walk every JSON-LD block looking for an Apartment/ApartmentComplex node.
  // StreetEasy currently emits one big block, but we tolerate multiple.
  let apartmentNode: GraphNode | null = null;
  for (const m of html.matchAll(JSON_LD_RE)) {
    const raw = m[1]!;
    try {
      const parsed = JSON.parse(raw);
      apartmentNode =
        findGraphNode(parsed, 'Apartment') ??
        findGraphNode(parsed, 'ApartmentComplex') ??
        apartmentNode;
      if (apartmentNode) break;
    } catch (e) {
      logger.warn({ err: String(e) }, 'StreetEasy JSON-LD parse failed; skipping block');
    }
  }

  const formattedBedrooms = findFormatted(html, 'formattedBedrooms');
  const formattedBathrooms = findFormatted(html, 'formattedBathrooms');
  const formattedAddress = findFormatted(html, 'formattedAddress');

  // Address: prefer JSON-LD streetAddress, fallback to formattedAddress
  let address: string | null = null;
  let unit: string | null = null;
  if (apartmentNode && typeof apartmentNode.address === 'object' && apartmentNode.address) {
    const addr = apartmentNode.address as Record<string, unknown>;
    const street = typeof addr.streetAddress === 'string' ? addr.streetAddress : null;
    const locality = typeof addr.addressLocality === 'string' ? addr.addressLocality : null;
    const region = typeof addr.addressRegion === 'string' ? addr.addressRegion : null;
    const zip = typeof addr.postalCode === 'string' ? addr.postalCode : null;
    if (street) {
      address = [street, locality, region, zip].filter(Boolean).join(', ');
      const unitMatch = street.match(/#([A-Z0-9-]+)/i);
      if (unitMatch) unit = unitMatch[1]!;
    }
  }
  if (!address && formattedAddress) {
    address = formattedAddress;
    const unitMatch = formattedAddress.match(/#([A-Z0-9-]+)/i);
    if (unitMatch) unit = unitMatch[1]!;
  }

  // Building pages have no address-bearing Apartment node → still try formattedAddress + og
  if (!address) {
    const ogTitle = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/);
    if (ogTitle) {
      // og:title for buildings is just the address; for rentals it's "<addr> in <neigh>, <boro> | StreetEasy"
      address = ogTitle[1]!.replace(/\s*\|\s*StreetEasy\s*$/i, '').replace(/\s+in\s+[^,]+,\s+\w+$/i, '');
    }
  }

  // Price (rentals only — building/sale → null)
  let monthlyRentCents: number | null = null;
  if (kind === 'rental' && apartmentNode) {
    // Monthly Rent additionalProperty
    const ap = apartmentNode.additionalProperty as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(ap)) {
      for (const prop of ap) {
        if (prop?.name === 'Monthly Rent' && typeof prop.value === 'string') {
          monthlyRentCents = parsePriceToCents(prop.value);
          break;
        }
      }
    }
    // Fallback: event[0].offers.price (integer dollars)
    if (monthlyRentCents == null) {
      const events = apartmentNode.event as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(events) && events.length > 0) {
        const offers = events[0]?.offers as Record<string, unknown> | undefined;
        if (offers && typeof offers.price === 'number') {
          monthlyRentCents = offers.price * 100;
        }
      }
    }
  }

  // Beds / baths from formatted strings
  const bedrooms = formattedBedrooms
    ? formattedBedrooms.toLowerCase().includes('studio')
      ? 0
      : parseInteger(formattedBedrooms)
    : null;
  const bathrooms = formattedBathrooms ? parseInteger(formattedBathrooms) : null;

  // Amenities: filter to value:true entries
  const amenities: string[] = [];
  if (apartmentNode) {
    const af = apartmentNode.amenityFeature as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(af)) {
      for (const a of af) {
        if (a?.value === true && typeof a?.name === 'string') {
          amenities.push((a.name as string).replace(/_/g, ' '));
        }
      }
    }
  }

  // Description + availability + title
  let description: string | null = null;
  let availabilityDate: string | null = null;
  let title: string | null = null;
  if (apartmentNode) {
    const events = apartmentNode.event as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(events) && events.length > 0) {
      const ev = events[0]!;
      if (typeof ev.description === 'string') description = ev.description;
      if (typeof ev.name === 'string') title = ev.name;
      const offers = ev.offers as Record<string, unknown> | undefined;
      if (offers && typeof offers.validFrom === 'string') availabilityDate = offers.validFrom;
    }
  }

  // FARE Act / broker-fee inference from the description
  const fee = detectBrokerFee(description);

  // Confidence: high if we got address + price + beds; medium if address only; low otherwise
  const confidence: 'high' | 'medium' | 'low' =
    address && (monthlyRentCents || kind !== 'rental') && bedrooms != null
      ? 'high'
      : address
        ? 'medium'
        : 'low';

  if (!address) {
    logger.warn({ url }, 'StreetEasy extractor: no address found');
    return null;
  }

  return {
    url,
    source: 'streeteasy',
    source_kind: kind,
    fetchedAt: new Date().toISOString(),
    address,
    unit,
    monthlyRentCents,
    bedrooms,
    bathrooms,
    squareFeet: null, // StreetEasy commonly hides sqft; null is honest
    brokerFeeStated: fee.stated,
    brokerFeeText: fee.text,
    securityDepositText: null, // could be parsed from description with regex; v1 leaves null
    leaseTermMonths: null,
    petsPolicy: null,
    utilitiesIncluded: [],
    amenities,
    availabilityDate,
    description: capDescription(description),
    title,
    daysOnMarket: null,
    agentName: null,
    brokerage: null,
    confidence,
  };
}
