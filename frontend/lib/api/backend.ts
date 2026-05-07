// RentGuard backend API client (frontend-side).
// Attaches Supabase session token when available; falls back to anon cookie.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

/**
 * Public-facing shape of the listing scrape result.
 * Mirrors backend ScrapedListing — kept in sync by hand for now.
 */
export type ScrapedListingPublic = {
  url: string;
  source: 'streeteasy' | 'zillow' | 'generic';
  source_kind: 'rental' | 'building' | 'sale' | 'unknown';
  fetchedAt: string;
  address: string | null;
  unit: string | null;
  monthlyRentCents: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  squareFeet: number | null;
  brokerFeeStated: 'no_fee' | 'fee' | 'unknown';
  brokerFeeText: string | null;
  securityDepositText: string | null;
  leaseTermMonths: number | null;
  petsPolicy: string | null;
  utilitiesIncluded: string[];
  amenities: string[];
  availabilityDate: string | null;
  description: string | null;
  title: string | null;
  daysOnMarket: number | null;
  agentName: string | null;
  brokerage: string | null;
  confidence: 'high' | 'medium' | 'low';
};

export type ScoreBand = 'minimal' | 'moderate' | 'elevated' | 'high';

export type ScoreFactor = {
  key: string;
  label: string;
  impact: number;
  reason: string;
};

export type LookupResponse =
  | {
      kind: 'success';
      bbl: string;
      address: string;
      borough: string;
      /** Phase 4.5: 2-3 sentence narrative of what the listing offers. */
      listing_summary: string | null;
      summary: string;
      /** Phase 4.5: AI-narrated explanation of the score. */
      score_explanation: string | null;
      /** Phase 4.5: deterministic 0-100 score. */
      score: number | null;
      score_band: ScoreBand | null;
      score_factors: ScoreFactor[];
      indicators: Array<{ key: string; value: string; source_url: string }>;
      /**
       * 3–5 specific factual questions the renter should ask the broker /
       * landlord / HPD before signing. Always non-empty for fresh lookups;
       * may be [] for older cached entries from before the prompt update.
       */
      questions_to_ask: string[];
      /**
       * Verbatim-anchored neutral observations about the listing copy.
       * Empty when the user did not paste a listing description.
       */
      listing_notes: Array<{ snippet: string; note: string }>;
      /**
       * Phase 4: structured data scraped from the listing URL the user
       * pasted. Null when the user pasted only an address.
       */
      scraped_listing: ScrapedListingPublic | null;
      landlord: AnyRecord;
      fare_check: AnyRecord | null;
      stats: Record<string, number>;
      lookup_id: string | null;
      building_url: string;
    }
  | { kind: 'requires_address'; reason: string }
  | { kind: 'outside_nyc'; detected_city: string | null; detected_state: string | null }
  | { kind: 'ambiguous'; matches: Array<{ bbl: string; address: string; borough: string }> }
  | { kind: 'email_gate'; message: string }
  | { kind: 'cost_cap'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'invalid_input'; errors: AnyRecord }
  | { kind: 'not_found' }
  // Phase 4: listing-fetch error states from the scrape pipeline
  | { kind: 'listing_blocked'; message: string | null }
  | { kind: 'listing_not_found'; message?: string | null }
  | { kind: 'listing_expired'; message?: string | null }
  | { kind: 'unsupported_url'; message?: string | null };

// Default by NODE_ENV so prod works without a Vercel-dashboard env var.
// Local devs override via frontend/.env.local (NEXT_PUBLIC_BACKEND_URL=http://localhost:8080).
const PROD_BACKEND_URL = 'https://rentguardai.onrender.com';
const DEV_BACKEND_URL = 'http://localhost:8080';
const BASE =
  process.env.NEXT_PUBLIC_BACKEND_URL ??
  (process.env.NODE_ENV === 'production' ? PROD_BACKEND_URL : DEV_BACKEND_URL);

async function authHeader(): Promise<HeadersInit> {
  try {
    const { createClient } = await import('@/lib/supabase/browser');
    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : {};
  } catch {
    return {};
  }
}

export async function postLookup(input: {
  address?: string;
  listingUrl?: string;
  listingDescription?: string;
  email?: string;
}): Promise<LookupResponse> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}/v1/lookup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(input),
  });
  return (await res.json()) as LookupResponse;
}

export async function postAffiliateClick(input: {
  partner: 'lemonade' | 'bellhop' | 'moved';
  referrerUrl?: string;
  proceeded: boolean;
}): Promise<void> {
  const auth = await authHeader();
  await fetch(`${BASE}/v1/affiliate/click`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(input),
  });
}

export async function postWaitlistEmail(email: string): Promise<void> {
  await fetch(`${BASE}/v1/waitlist/email`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function getBuildingByBbl(bbl: string): Promise<LookupResponse> {
  // 1h revalidation gives the backend a chance to pick up backfilled data on
  // the buildings table within an hour of any /v1/lookup call. The page-level
  // `revalidate = 86400` in app/building/[bbl]/page.tsx is the upper bound;
  // this fetch-level setting is a tighter ceiling on staleness for the API
  // payload (not the rendered page).
  const res = await fetch(`${BASE}/v1/building/${bbl}`, {
    credentials: 'include',
    cache: 'force-cache',
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — Next.js extends RequestInit with `next`
    next: { revalidate: 3600 },
  });
  return (await res.json()) as LookupResponse;
}
