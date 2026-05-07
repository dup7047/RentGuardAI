// Canonical shape for a scraped NYC rental listing.
// Every per-host extractor returns this; downstream consumers (cache,
// /v1/lookup, AI prompt) operate on this shape only.

export type FareFee = 'no_fee' | 'fee' | 'unknown';

export type ListingSource = 'streeteasy' | 'zillow' | 'generic';

/**
 * StreetEasy distinguishes /rental/, /building/, /sale/. Other sources collapse
 * to 'unknown'. `building` listings have no specific unit, so price/beds/baths
 * stay null even on a successful scrape.
 */
export type ListingSourceKind = 'rental' | 'building' | 'sale' | 'unknown';

export type ScrapedListing = {
  url: string;                      // canonical URL (tracking params stripped)
  source: ListingSource;
  source_kind: ListingSourceKind;
  fetchedAt: string;                // ISO timestamp

  // Address (drives the geocoder)
  address: string | null;
  unit: string | null;

  // Pricing
  monthlyRentCents: number | null;  // 450000 for $4,500/mo

  // Layout
  bedrooms: number | null;          // 0 = studio
  bathrooms: number | null;         // 0.5, 1, 1.5, ...
  squareFeet: number | null;

  // Terms (the things renters need to verify before signing)
  brokerFeeStated: FareFee;
  brokerFeeText: string | null;     // verbatim e.g. "broker fee equals one month"
  securityDepositText: string | null;
  leaseTermMonths: number | null;
  petsPolicy: string | null;
  utilitiesIncluded: string[];
  amenities: string[];
  availabilityDate: string | null;  // ISO date when stated (move-in)

  // Listing copy
  description: string | null;       // capped at 8000 chars at extractor output
  title: string | null;
  daysOnMarket: number | null;
  agentName: string | null;
  brokerage: string | null;

  // Quality (helps the API + UI signal extraction confidence)
  confidence: 'high' | 'medium' | 'low';
};

/**
 * Why scraping failed — distinct codes drive different UX in the frontend
 * (e.g. listing_blocked → reveal manual paste fallback).
 */
export type ScrapeError =
  | 'listing_blocked'    // bot protection won and we couldn't extract
  | 'listing_not_found'  // 404
  | 'listing_expired'    // page rendered but indicates sold/rented
  | 'unsupported_url';   // URL doesn't match any extractor + no JSON-LD/OG fallback

export type ScrapeResult =
  | { kind: 'ok'; data: ScrapedListing; fetchMethod: 'direct' | 'scrapfly' | 'cache' }
  | { kind: 'error'; code: ScrapeError; status?: number; message?: string };

/**
 * Cap stored description size. The AI-side prompt builder applies a tighter
 * 4000-char truncation for token-budget reasons; this larger cap exists so we
 * can re-prompt with a longer context later if we change models.
 */
export const DESCRIPTION_STORAGE_CAP_CHARS = 8000;
