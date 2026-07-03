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
  source: 'streeteasy' | 'zillow';
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
export type ValueBand = 'great_deal' | 'fair' | 'above_market' | 'overpriced';
export type ValueConfidence = 'high' | 'medium' | 'low';

export type ScoreFactor = {
  key: string;
  label: string;
  impact: number;
  reason: string;
};

/** Maps the backend's 4-band score onto the design's 3 tone classes
 *  (the prototype CSS only defines `.pill.good`, `.pill.warn`, `.pill.bad`).
 *  `minimal` → good · `moderate`/`elevated` → warn · `high` → bad. */
export type ReportTone = 'good' | 'warn' | 'bad';
export function getReportTone(band: ScoreBand | null | undefined): ReportTone {
  if (band === 'minimal') return 'good';
  if (band === 'high') return 'bad';
  return 'warn';
}

/** Human-readable label for a band, used in the address-card pill. */
export function getBandLabel(band: ScoreBand | null | undefined): string {
  switch (band) {
    case 'minimal':
      return 'Minimal concern';
    case 'moderate':
      return 'Moderate concern';
    case 'elevated':
      return 'Elevated concern';
    case 'high':
      return 'High concern';
    default:
      return 'Score unavailable';
  }
}

export function getValueTone(band: ValueBand | null | undefined): ReportTone {
  if (band === 'great_deal') return 'good';
  if (band === 'overpriced') return 'bad';
  if (band === 'fair') return 'good';
  return 'warn';
}

export function getValueBandLabel(band: ValueBand | null | undefined): string {
  switch (band) {
    case 'great_deal': return 'Great deal';
    case 'fair': return 'Fair market rate';
    case 'above_market': return 'Above market';
    case 'overpriced': return 'Overpriced';
    default: return 'Value score unavailable';
  }
}

export type HpdViolationRow = {
  violationid: string;
  class?: string;
  novissueddate?: string;
  inspectiondate?: string;
  currentstatus?: string;
  currentstatusdate?: string;
  novdescription?: string;
  apartment?: string;
};

export type DobComplaintRow = {
  complaint_number: string;
  complaint_category?: string;
  date_entered?: string;
  status?: string;
  disposition_code?: string;
  disposition_date?: string;
};

export type ThreeOneOneRow = {
  unique_key: string;
  created_date?: string;
  agency?: string;
  complaint_type?: string;
  descriptor?: string;
  status?: string;
};

export type EvictionRow = {
  court_index_number: string;
  executed_date?: string;
  eviction_address?: string;
  eviction_apt_num?: string;
  residential_commercial_ind?: string;
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
      /**
       * Apartment Value Score (0-100, higher = better deal). Null for address-only
       * lookups or when the listing lacks rent / beds.
       */
      value_score: number | null;
      value_band: ValueBand | null;
      value_confidence: ValueConfidence | null;
      value_factors: ScoreFactor[];
      /** AI-narrated explanation of the value score citing comp medians. */
      value_explanation: string | null;
      /**
       * True when the user pasted a listing URL but the scraper was blocked
       * and we fell back to parsing the address out of the URL slug. The
       * report still has full public-records coverage but listing-specific
       * fields (rent, beds, broker fee, listing notes) aren't available.
       * Frontend should surface this so users know the review is
       * building-only, not listing-specific.
       */
      listing_unavailable?: boolean;
      landlord: AnyRecord;
      fare_check: AnyRecord | null;
      stats: Record<string, number>;
      lookup_id: string | null;
      building_url: string;
      bin?: string | null;
      hpd_building_id?: string | null;
      violations_rows?: HpdViolationRow[];
      complaints_rows?: { dob: DobComplaintRow[]; threeoneone: ThreeOneOneRow[] };
      evictions_rows?: EvictionRow[];
      total_counts?: {
        violations: number;
        dob: number;
        threeoneone: number;
        evictions: number;
      };
      has_more?: { violations: boolean; dob: boolean; threeoneone: boolean; evictions: boolean };
      partial?: string[];
    }
  | { kind: 'requires_address'; reason: string }
  | { kind: 'outside_nyc'; detected_city: string | null; detected_state: string | null }
  | { kind: 'ambiguous'; matches: Array<{ bbl: string; address: string; borough: string }> }
  | { kind: 'email_gate'; message: string }
  | { kind: 'signup_gate'; message: string }
  | { kind: 'cost_cap'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'invalid_input'; errors: AnyRecord }
  | { kind: 'server_error'; message: string }
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

// ── Retry + cold-start hint ──────────────────────────────────────────────────
// Render's free tier spins the backend down after ~15 min of idle. First
// request after spin-down can take 20-30s. Without retry, users hit a 502/503
// or naked timeout. withRetry handles two things:
//   1. Exponential backoff for network errors and 5xx (capped at 3 retries).
//   2. Emits a single 'rentguard:request-slow' on the window when the FIRST
//      attempt within this call crosses 5s in-flight, and a matching
//      'rentguard:request-slow-end' when the whole call resolves. The UI
//      hook (useColdStartHint) counts events as ±1, so emitting more than
//      once per call would leak a positive counter on retried slow requests.
// 4xx is never retried — those are client problems, retries won't help.

const RETRY_DELAYS_MS = [1_000, 3_000, 9_000] as const; // total ≤ 13s
const SLOW_THRESHOLD_MS = 5_000;

export type RetryOptions = {
  /** Skip emitting the slow-request hint (e.g. for ambient polling calls). */
  silent?: boolean;
};

function dispatchSlow(silent: boolean): void {
  if (silent) return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('rentguard:request-slow'));
}

function dispatchSlowEnd(silent: boolean): void {
  if (silent) return;
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('rentguard:request-slow-end'));
}

function isRetryableStatus(status: number): boolean {
  // 502, 503, 504 = Render proxy / cold-start signals.
  // 500 is included as well; if the backend is throwing 500s a retry is
  // cheap and may catch a transient.
  return status === 500 || status === 502 || status === 503 || status === 504;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const silent = opts.silent === true;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  // `slowEmitted` gates BOTH the slow dispatch (set inside the timer
  // callback) and the slow-end dispatch (outer finally). It is set ONCE
  // per withRetry call and never reset between attempts, so a request
  // that retries through multiple >5s attempts still produces exactly
  // one slow + one slow-end pair. Without this guard, attempt 1 firing
  // slow and attempt 2 firing slow would leak +1 in the consumer's
  // pending counter.
  let slowEmitted = false;

  const armSlowTimer = () => {
    slowTimer = setTimeout(() => {
      if (slowEmitted) return;
      slowEmitted = true;
      dispatchSlow(silent);
    }, SLOW_THRESHOLD_MS);
  };
  const disarmSlowTimer = () => {
    if (slowTimer) clearTimeout(slowTimer);
    slowTimer = undefined;
  };

  try {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      armSlowTimer();
      try {
        const result = await fn();
        disarmSlowTimer();
        return result;
      } catch (err) {
        disarmSlowTimer();
        const status = (err as { status?: number }).status;
        const retryable = typeof status === 'number' ? isRetryableStatus(status) : true;
        const isLast = attempt === RETRY_DELAYS_MS.length;
        if (!retryable || isLast) throw err;
        const delay = RETRY_DELAYS_MS[attempt];
        if (delay !== undefined) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    // Unreachable — the loop returns or throws inside.
    throw new Error('withRetry: exhausted retries');
  } finally {
    disarmSlowTimer();
    if (slowEmitted) dispatchSlowEnd(silent);
  }
}

/** Status-aware fetch error so retry logic can distinguish 4xx from 5xx. */
export class FetchHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'FetchHttpError';
    this.status = status;
    this.body = body;
  }
}

/** Fetch + withRetry combo. Throws FetchHttpError on non-2xx so the caller
 *  can switch on `err.status` (4xx for validation/auth, 5xx already retried). */
export async function fetchWithRetry(
  input: string,
  init: RequestInit = {},
  retry: RetryOptions = {},
): Promise<Response> {
  return withRetry(async () => {
    const res = await fetch(input, init);
    if (!res.ok && isRetryableStatus(res.status)) {
      // Trigger retry by throwing — the body is preserved on the error for
      // diagnostics, though most retryable 5xx have empty bodies anyway.
      let body: unknown = null;
      try {
        body = await res.clone().json();
      } catch {
        // 5xx often returns HTML/text; ignore parse failure.
      }
      throw new FetchHttpError(res.status, body, `Retryable HTTP ${res.status}`);
    }
    return res;
  }, retry);
}

// Exported so callers and tests can prove the same auth header is built for
// every request. Internal callers below still use it via the closure.
export async function authHeader(): Promise<HeadersInit> {
  const { getCurrentSession } = await import('@/lib/auth/session');
  const session = await getCurrentSession();
  // Diagnostic: log whether a token is being sent. Pair with the backend's
  // `jwt verify failed` log in Render — `tokenSent: true` here + that log on
  // the backend = env mismatch. `tokenSent: false` = client-side session
  // missing despite the user being signed in. Dev-only: in production this
  // fired a console.warn on every single API request.
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    console.warn('[authHeader] building request', { tokenSent: Boolean(session) });
  }
  return session ? { Authorization: `Bearer ${session.access_token}` } : {};
}

export async function postLookup(input: {
  address?: string;
  listingUrl?: string;
  listingDescription?: string;
  email?: string;
  bbl?: string;
}): Promise<LookupResponse> {
  const auth = await authHeader();
  const res = await fetchWithRetry(`${BASE}/v1/lookup`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(input),
  });
  return (await res.json()) as LookupResponse;
}

/**
 * Phase 6: streaming variant of postLookup. Reads NDJSON phase events from
 * the backend so the Loading interstitial can advance step-by-step in sync
 * with what the backend is actually doing.
 *
 * Each phase line: {"event":"phase","name":"parse"|"geo"|"hpd"|"dob"|"owner"|"ai"}
 * Final line:      {"event":"complete","status":number,"response":<LookupResponse>}
 *
 * Phase events fire `onPhase(name)`. The function resolves with the final
 * response. Throws if the stream ends without a complete event (network drop).
 */
export type LookupPhase = 'parse' | 'geo' | 'hpd' | 'dob' | 'owner' | 'ai';

export async function postLookupStream(
  input: {
    address?: string;
    listingUrl?: string;
    listingDescription?: string;
    email?: string;
    /** Optional pre-resolved BBL from the autocomplete suggestion the user
     *  picked. Lets the backend skip the GeoSearch round-trip on the
     *  type-then-pick flow. Drop when the user edits the input. */
    bbl?: string;
  },
  onPhase: (name: LookupPhase) => void,
): Promise<LookupResponse> {
  const auth = await authHeader();
  // Retry only the initial connect; mid-stream failures are not safe to
  // restart (we'd lose any progressive events already consumed). The retry
  // helper unwinds via FetchHttpError on 5xx; pre-stream envelope errors
  // (e.g. validation_failed → 400) flow through unchanged.
  const res = await fetchWithRetry(`${BASE}/v1/lookup/stream`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(input),
  });
  if (!res.body) {
    throw new Error('Streaming response missing body');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  // Drain the stream, parsing one JSON object per newline. Multi-line chunks
  // and lines split across chunks are both handled by the buffer.
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line) as
        | { event: 'phase'; name: LookupPhase }
        | { event: 'data_ready'; data: unknown }
        | { event: 'complete'; status: number; response: LookupResponse };
      if (msg.event === 'phase') {
        onPhase(msg.name);
      } else if (msg.event === 'complete') {
        return msg.response;
      }
      // 'data_ready' is a progressive-payload event for future UI use; the
      // current loading screen drives off `onPhase` only, so we ignore it
      // here. Adding an `onDataReady` callback later is forward-compatible.
    }
    if (done) break;
  }
  throw new Error('Lookup stream ended without complete event');
}

export async function postAffiliateClick(input: {
  partner: 'lemonade' | 'bellhop' | 'moved';
  referrerUrl?: string;
  proceeded: boolean;
}): Promise<void> {
  const auth = await authHeader();
  // Fire-and-forget telemetry — silent so a slow logging call doesn't flash
  // the "Warming up…" hint while the user is mid-flow.
  await fetchWithRetry(
    `${BASE}/v1/affiliate/click`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(input),
    },
    { silent: true },
  );
}

export async function postWaitlistEmail(email: string): Promise<void> {
  await fetchWithRetry(`${BASE}/v1/waitlist/email`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function getBuildingByBbl(
  bbl: string,
  opts: { noStore?: boolean } = {},
): Promise<LookupResponse> {
  // Default: 1h revalidation gives the backend a chance to surface backfilled
  // data without thrashing the cache. The page-level `revalidate = 86400` in
  // app/building/[bbl]/page.tsx is the upper bound.
  //
  // When `noStore: true` (e.g. right after a fresh lookup with ?fresh=1),
  // bypass the data cache entirely so users see their freshly-generated
  // score / listing_summary / scraped_listing without waiting for revalidation.
  const init: RequestInit = {
    credentials: 'include',
    ...(opts.noStore
      ? { cache: 'no-store' as RequestCache }
      : {
          cache: 'force-cache' as RequestCache,
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore — Next.js extends RequestInit with `next`
          next: { revalidate: 3600 },
      }),
  };
  try {
    const res = await fetch(`${BASE}/v1/building/${bbl}`, init);
    const contentType = res.headers.get('content-type') ?? '';
    const body = contentType.includes('application/json')
      ? ((await res.json()) as LookupResponse)
      : null;

    if (body?.kind) return body;
    if (res.status === 404) return { kind: 'not_found' };
    return {
      kind: 'server_error',
      message: 'We could not load this building report. Please try again.',
    };
  } catch {
    return {
      kind: 'server_error',
      message: 'We could not reach the report service. Please try again.',
    };
  }
}

// ── Saved buildings ────────────────────────────────────────────────────────
// All four endpoints require an authed user. The backend returns 401 when
// the Bearer token is missing or invalid; callers should surface that as a
// "please sign in" UX (the existing SignInModal already handles it).

export type SavedBuilding = {
  bbl: string;
  address: string | null;
  borough: string | null;
  saved_at: string;
  score: number | null;
  score_band: ScoreBand | null;
};

export class SavedBuildingsAuthError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'SavedBuildingsAuthError';
  }
}

async function savedBuildingsFetch(path: string, init: RequestInit): Promise<Response> {
  const auth = await authHeader();
  // Saved-buildings calls run in the dashboard — silent so the cold-start
  // hint only fires on the user-initiated lookup flow, not on ambient list
  // refreshes that happen on page-load.
  const res = await fetchWithRetry(
    `${BASE}${path}`,
    {
      ...init,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...auth, ...(init.headers ?? {}) },
    },
    { silent: true },
  );
  if (res.status === 401) throw new SavedBuildingsAuthError();
  return res;
}

export async function getSavedBuildingState(
  bbl: string,
): Promise<{ saved: boolean; saved_at?: string }> {
  const res = await savedBuildingsFetch(`/v1/saved-buildings/${bbl}`, { method: 'GET' });
  return (await res.json()) as { saved: boolean; saved_at?: string };
}

export async function saveBuilding(
  bbl: string,
): Promise<{ saved: true; saved_at: string }> {
  const res = await savedBuildingsFetch('/v1/saved-buildings', {
    method: 'POST',
    body: JSON.stringify({ bbl }),
  });
  return (await res.json()) as { saved: true; saved_at: string };
}

export async function unsaveBuilding(bbl: string): Promise<{ saved: false }> {
  const res = await savedBuildingsFetch(`/v1/saved-buildings/${bbl}`, { method: 'DELETE' });
  return (await res.json()) as { saved: false };
}

export async function listSavedBuildings(): Promise<{
  items: SavedBuilding[];
  total_count: number;
}> {
  const res = await savedBuildingsFetch('/v1/saved-buildings', { method: 'GET' });
  return (await res.json()) as { items: SavedBuilding[]; total_count: number };
}
