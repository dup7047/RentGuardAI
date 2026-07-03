// POST /v1/lookup — master endpoint for Phase 3.
// Composes: URL parse → geocode → counter check → data fetch →
//           FARE check → AI summary (with cost cap) → persist → respond.
//
// Phase 6: the pipeline body is extracted into `runLookup(input, ctx, emit)`
// so two routes can share it:
//   - POST /v1/lookup        → original JSON-blob response (this file)
//   - POST /v1/lookup/stream → NDJSON streaming with phase events (this file)
// Both share the same `runLookup` so behavior never drifts between them.

import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import { scrapeListing } from '../scraping/fetcher.js';
import type { ScrapedListing } from '../scraping/types.js';
import { detectListingHost, canonicalizeListingUrl } from '../scraping/url-canonicalize.js';
import { parseAddressFromUrl } from '../scraping/slug-parse.js';
import { geosearch } from '../geo/geosearch.js';
import { lookupLandlord } from '../data/landlord.js';
import { checkFare } from '../fare/check.js';
import { generateSummary, CostCapExceededError } from '../ai/summary.js';
import {
  projectHpdViolations,
  projectHpdComplaints,
  projectDobComplaints,
  project311Complaints,
} from '../ai/payload-records.js';
import { computeScore } from '../scoring/score.js';
import { computeValueScore } from '../scoring/value.js';
import { getComps } from '../data/comps.js';
import type { ValueScoreResult } from '../scoring/value.js';
import { getHpdViolations } from '../data/datasets/hpd-violations.js';
import { getDobComplaints } from '../data/datasets/dob-complaints.js';
import { getEvictions } from '../data/datasets/evictions.js';
import { getBedbugReports } from '../data/datasets/bedbug.js';
import { getLeadPaintViolations } from '../data/datasets/lead-paint.js';
import { getHpdRegistrations } from '../data/datasets/hpd-registrations.js';
import { getHpdComplaints } from '../data/datasets/hpd-complaints.js';
import { get311HousingRequests } from '../data/datasets/three11-housing.js';
import { getCachedBatch } from '../data/cache.js';
import { getDb } from '../db/client.js';
import { buildingLookups, buildings, nonNycWaitlist } from '../db/schema.js';
import { and, desc, eq, gt, isNotNull, isNull, like, or, sql as drizzleSql } from 'drizzle-orm';
import { LIMITS, countAnonLookups, incrementEmailCounter } from '../lib/counters.js';
import { fromZodIssues } from '../lib/errors.js';
import { logger } from '../logger.js';
import type { Borough } from '../data/types.js';

// NYC street addresses use letters, digits, spaces, and a small set of
// punctuation (#, /, ', &, parens, period, comma, hyphen). Rejecting `<`,
// `>`, quotes, and control characters at the API edge prevents anything
// shaped like `</script>…` from ever reaching the buildings.address column
// (which is later rendered inside a JSON-LD <script> block on the SEO archive).
const ADDRESS_REGEX = /^[A-Za-z0-9\s.,'\-#/&()]+$/;

const SUPPORTED_LISTING_HOSTS = ['streeteasy.com', 'zillow.com'] as const;

const Body = z
  .object({
    address: z.string().trim().min(2).max(200).regex(ADDRESS_REGEX).optional(),
    listingUrl: z
      .string()
      .trim()
      .max(2048)
      .url()
      .refine(
        (u) => {
          try {
            const p = new URL(u);
            if (p.protocol !== 'http:' && p.protocol !== 'https:') return false;
            const host = p.hostname.toLowerCase().replace(/^www\./, '');
            return SUPPORTED_LISTING_HOSTS.some((h) => host === h || host.endsWith('.' + h));
          } catch {
            return false;
          }
        },
        { message: 'listingUrl must be a StreetEasy or Zillow URL' },
      )
      .optional(),
    listingDescription: z.string().trim().max(8000).optional(),
    email: z.string().email().optional(),
    // Optional pre-resolved BBL from the frontend's autocomplete pick. Lets
    // us skip the GeoSearch round-trip entirely when the user picked a
    // suggestion (the suggestion already carries `addendum.pad.bbl` from
    // NYC Planning Labs). We still validate it loosely (10 digits) and fall
    // back to geocoding on any inconsistency. Public data, no trust risk.
    bbl: z.string().regex(/^\d{10}$/).optional(),
  })
  .refine((d) => d.address || d.listingUrl, { message: 'address or listingUrl required' });

export type LookupPhase = 'parse' | 'geo' | 'hpd' | 'dob' | 'owner' | 'ai';

/** Time a single phase of runLookup and emit a structured log line.
 *  Logger-only — does NOT emit a stream event, so the streaming phase
 *  contract stays at exactly 6 events (parse, geo, hpd, dob, owner, ai). */
async function timePhase<T>(phase: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    const v = await fn();
    logger.info(
      { phase, durationMs: Math.round((performance.now() - start) * 100) / 100 },
      'lookup phase completed',
    );
    return v;
  } catch (e) {
    logger.warn(
      {
        phase,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
        err: String(e),
      },
      'lookup phase failed',
    );
    throw e;
  }
}

/** Race a promise against a deadline. On timeout OR rejection, resolves with
 *  the fallback value and `degraded: true`; a timed-out promise keeps running
 *  but its result is discarded. Used to cap dataset fan-out tail latency and
 *  to make sure a failed dataset is surfaced as partial data rather than
 *  silently rendering as "no records". Exported for tests. */
export function withDeadline<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
  label?: string,
): Promise<{ value: T; degraded: boolean }> {
  let to: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ value: T; degraded: boolean }>((resolve) => {
    to = setTimeout(() => resolve({ value: fallback, degraded: true }), ms);
  });
  const settled = p
    .then((value) => ({ value, degraded: false }))
    .catch((e) => {
      logger.warn({ err: String(e), label }, 'dataset fetch failed — serving fallback');
      return { value: fallback, degraded: true };
    });
  return Promise.race([settled, timeout]).then((r) => {
    if (to) clearTimeout(to);
    return r;
  });
}

const DATASET_DEADLINE_MS = 5_000;

export type LookupCtx = {
  anonToken: string;
  userId?: string;
  userEmail?: string;
};

type LookupStatus = 200 | 400 | 402 | 404;
export type LookupResult = { status: LookupStatus; body: unknown };

// ── Phase 8: cache-hit short-circuit ──────────────────────────────────────
// When an address-only lookup arrives for a BBL we already summarized in the
// last 24 h, skip the OpenAI call and reuse the persisted AI fields. Same TTL
// as the dataset cache so the cached AI fields and the fresh dataset reads
// stay internally consistent.

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type CachedRow = {
  summary: string;
  questions: unknown;
  listingNotes: unknown;
  listingSummary: string | null;
  scoreExplanation: string | null;
  score: number;
  scoreBand: string;
  scoreFactors: unknown;
  // Value score (nullable — only present for URL-based lookups with rent data)
  valueScore: number | null;
  valueBand: string | null;
  valueConfidence: string | null;
  valueFactors: unknown;
  valueExplanation: string | null;
};

/**
 * Find the most recent address-only `building_lookups` row for a BBL whose AI
 * fields are all present and within the TTL. Returns null on miss.
 *
 * The `isNull(aiScrapedListing)` filter is critical — rows from URL-based
 * lookups had their score computed via `computeScore` with `scrapedListing`
 * set, which contributes listing-derived factors. Reusing one of those for a
 * brand-new address-only request would silently shift the score.
 */
async function findRecentLookup(bbl: string): Promise<CachedRow | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_MS);
  const [row] = await getDb()
    .select({
      summary: buildingLookups.aiSummary,
      questions: buildingLookups.aiQuestions,
      listingNotes: buildingLookups.aiListingNotes,
      listingSummary: buildingLookups.aiListingSummary,
      scoreExplanation: buildingLookups.aiScoreExplanation,
      score: buildingLookups.aiScore,
      scoreBand: buildingLookups.aiScoreBand,
      scoreFactors: buildingLookups.aiScoreFactors,
      valueScore: buildingLookups.aiValueScore,
      valueBand: buildingLookups.aiValueBand,
      valueConfidence: buildingLookups.aiValueConfidence,
      valueFactors: buildingLookups.aiValueFactors,
      valueExplanation: buildingLookups.aiValueExplanation,
    })
    .from(buildingLookups)
    .where(
      and(
        eq(buildingLookups.buildingBbl, bbl),
        isNotNull(buildingLookups.aiSummary),
        isNotNull(buildingLookups.aiScore),
        isNotNull(buildingLookups.aiScoreBand),
        isNull(buildingLookups.aiScrapedListing),
        gt(buildingLookups.createdAt, cutoff),
        // Skip rows generated by the pre-PR-#15 prompt rule. The current
        // [summary] rule MUST emit either "At-risk apartments:" (when units
        // recur) or "No specific units recurred across recent records." (when
        // they don't). Rows missing both markers are old-format and should be
        // regenerated even when they're still inside the 24h TTL.
        // If you change the prompt's required markers, update these patterns.
        or(
          like(buildingLookups.aiSummary, '%At-risk apartments:%'),
          like(buildingLookups.aiSummary, '%No specific units recurred%'),
        ),
      ),
    )
    .orderBy(desc(buildingLookups.createdAt))
    .limit(1);
  // Drizzle's column inference returns nullable types even when the WHERE
  // clause guarantees NOT NULL — narrow at runtime.
  if (!row || row.summary == null || row.score == null || row.scoreBand == null) {
    return null;
  }
  return {
    summary: row.summary,
    questions: row.questions,
    listingNotes: row.listingNotes,
    listingSummary: row.listingSummary,
    scoreExplanation: row.scoreExplanation,
    score: row.score,
    scoreBand: row.scoreBand,
    scoreFactors: row.scoreFactors,
    valueScore: row.valueScore ?? null,
    valueBand: row.valueBand ?? null,
    valueConfidence: row.valueConfidence ?? null,
    valueFactors: row.valueFactors,
    valueExplanation: row.valueExplanation ?? null,
  };
}

/**
 * Runs the lookup pipeline. Pure function (no Hono Context coupling) so
 * both `/v1/lookup` (JSON) and `/v1/lookup/stream` (NDJSON) can call it.
 *
 * Errors known to the pipeline are returned as `{ status, body }` results.
 * Only truly unexpected exceptions (DB outage etc.) throw — the streaming
 * route catches those and writes a synthetic complete event; the JSON
 * route lets Hono's default error handler turn them into a 500.
 *
 * Phase emit semantics:
 *   - `parse`  : after scrapeListing succeeds, OR after the listing_blocked
 *                recovery path sets resolvedAddress, OR immediately for
 *                requests that don't need scraping (address-only, or
 *                URL+address from the frontend's listing_blocked retry).
 *                Skipped on scrape errors that abort the pipeline.
 *   - `geo`    : after geosearch resolves with a usable BBL (NOT for
 *                outside_nyc / ambiguous early returns).
 *   - `hpd`    : when getHpdViolations resolves.
 *   - `dob`    : when getDobComplaints resolves.
 *   - `owner`  : when lookupLandlord resolves.
 *   - `ai`     : immediately BEFORE generateSummary is called (so the user
 *                sees "AI is now working", not "AI is now done").
 */
export async function runLookup(
  input: unknown,
  ctx: LookupCtx,
  emit: (p: LookupPhase) => void = () => {},
  emitData: (data: object) => void = () => {},
): Promise<LookupResult> {
  const reqStart = performance.now();
  // ── 1. Parse + validate body ────────────────────────────────────────────────
  const parsed = Body.safeParse(input);
  if (!parsed.success) {
    return { status: 400, body: { kind: 'invalid_input', errors: parsed.error.flatten() } };
  }

  // `listingUrl` is `let` because the slug-parse fallback in step 2 clears it
  // so the rest of the pipeline (cache short-circuit, persistence) treats the
  // request as address-only when we couldn't actually scrape the page.
  // eslint-disable-next-line prefer-const -- intentional mutation below
  let { listingUrl } = parsed.data;
  const { address, listingDescription, email, bbl: providedBbl } = parsed.data;
  const { anonToken, userId } = ctx;
  const userEmail = ctx.userEmail ?? email;

  // ── 2. URL fetch + extract (Phase 4 — replaces the slug-only parser) ────────
  let resolvedAddress = address;
  let scrapedListing: ScrapedListing | null = null;
  // Set when we recover from a scrape failure by parsing the address out of
  // the URL slug. The response carries this back so the UI can tell the user
  // the review covers public records only (no listing-specific fields).
  let listingUnavailable = false;
  if (listingUrl && !resolvedAddress) {
    // Capture in a const so the closure passed to timePhase doesn't see the
    // post-slug-parse `listingUrl = undefined` reassignment below.
    const scrapeUrl = listingUrl;
    const r = await timePhase('scrape', () => scrapeListing(scrapeUrl));
    if (r.kind === 'error') {
      // 'listing_blocked' is recoverable if the user pasted a description and address
      // (defensive — the current LookupForm sends address+url together on retry,
      // which means we don't hit this branch in practice; preserved for safety).
      if (r.code === 'listing_blocked' && listingDescription && address) {
        resolvedAddress = address;
        emit('parse');
      } else if (r.code === 'listing_blocked' || r.code === 'listing_expired') {
        // Slug-parse fallback: the address is already in the URL path for
        // most Zillow / StreetEasy listings. Pull it out and route as
        // address-only — user gets a building report instead of the
        // manual-paste fallback. We lose listing-specific fields but
        // those are unrecoverable when the scraper is blocked anyway.
        const detect = detectListingHost(listingUrl);
        const canonical = canonicalizeListingUrl(listingUrl);
        const fromSlug = detect ? parseAddressFromUrl(canonical, detect.source) : null;
        if (fromSlug) {
          logger.info(
            { source: detect!.source, url: canonical, parsedAddress: fromSlug },
            'slug-parse fallback hit — routing as address-only',
          );
          resolvedAddress = fromSlug;
          // Drop listingUrl from the rest of the pipeline so the AI cache
          // short-circuit (which keys on `!listingUrl && !listingDescription`)
          // sees this as an address-only lookup. Also: scrapedListing stays
          // null, so cache hits remain eligible for future cache hits.
          listingUrl = undefined;
          listingUnavailable = true;
          emit('parse');
        } else {
          const status: LookupStatus = 200;
          return { status, body: { kind: r.code, message: r.message ?? null } };
        }
      } else {
        const status: LookupStatus = r.code === 'listing_not_found' ? 404 : 200;
        return { status, body: { kind: r.code, message: r.message ?? null } };
      }
    } else {
      scrapedListing = r.data;
      emit('parse');
      if (r.data.address) {
        resolvedAddress = r.data.address;
      } else {
        return {
          status: 200,
          body: { kind: 'requires_address', reason: 'scraped_no_address' },
        };
      }
    }
  } else {
    // Address-only OR both URL+address (frontend's listing_blocked retry path).
    // No scrape needed; "parse" is conceptually done immediately.
    emit('parse');
  }
  if (!resolvedAddress) {
    return { status: 400, body: { kind: 'invalid_input', errors: { address: 'required' } } };
  }

  // ── 3. Geocode ───────────────────────────────────────────────────────────────
  // Fast path: when the frontend forwards a BBL captured from the autocomplete
  // suggestion AND we already have a canonical address+borough in the buildings
  // table from a prior lookup, skip the GeoSearch round-trip. On first sighting
  // (no cached row, or row exists with empty address/borough) we must geocode —
  // trusting the user-supplied `address` here would let it land in
  // buildings.address verbatim, which is later rendered into a JSON-LD <script>
  // block on the SEO archive page.
  let bbl: string;
  let canonicalAddress: string;
  let borough: Borough;
  const cachedBuilding = providedBbl
    ? await getDb()
        .select({ address: buildings.address, borough: buildings.borough })
        .from(buildings)
        .where(eq(buildings.bbl, providedBbl))
        .limit(1)
        .then((rows) => rows[0])
    : undefined;
  if (
    providedBbl &&
    cachedBuilding?.address &&
    cachedBuilding.address.length > 0 &&
    cachedBuilding.borough &&
    cachedBuilding.borough.length > 0
  ) {
    bbl = providedBbl;
    canonicalAddress = cachedBuilding.address;
    borough = cachedBuilding.borough as Borough;
    logger.info({ phase: 'geo', durationMs: 0, source: 'bbl_bypass' }, 'lookup phase completed');
  } else {
    const g = await timePhase('geo', () => geosearch(resolvedAddress!));
    if (g.kind === 'outside_nyc') {
      if (userEmail) {
        await getDb()
          .insert(nonNycWaitlist)
          .values({
            email: userEmail,
            attemptedAddress: resolvedAddress,
            requestedCity: g.detected_city ?? 'unknown',
            requestedState: g.detected_state ?? 'unknown',
          })
          .onConflictDoNothing();
      }
      return {
        status: 200,
        body: {
          kind: 'outside_nyc',
          detected_city: g.detected_city,
          detected_state: g.detected_state,
        },
      };
    }
    if (g.kind === 'ambiguous') {
      // If the frontend forwarded a BBL from the disambiguation picker, resolve
      // to that candidate directly instead of bouncing the user back to the
      // same "Pick the right address" screen. (Re-geocoding the chosen label
      // alone doesn't disambiguate: for hyphenated Queens addresses like
      // 140-02 / 140-10 / 140-17 the housenumber-digit filter collapses them
      // all to "140", so GeoSearch returns the same tie every time — an
      // infinite loop.) We take address+borough from OUR geosearch match, not
      // the user-supplied override, so nothing untrusted lands in
      // buildings.address / the JSON-LD archive page.
      const picked = providedBbl
        ? g.matches.find((m) => m.bbl === providedBbl)
        : undefined;
      if (!picked) {
        return { status: 200, body: { kind: 'ambiguous', matches: g.matches } };
      }
      bbl = picked.bbl;
      canonicalAddress = picked.address;
      borough = picked.borough;
    } else {
      bbl = g.bbl;
      canonicalAddress = g.address;
      borough = g.borough;
    }
  }

  // Geo succeeded — emit only on the success path. Outside-NYC and ambiguous
  // are dead-ends; emitting `geo` for them would be misleading on the UI.
  emit('geo');

  // ── 3b. Upsert canonical address/borough on buildings row ───────────────────
  // The dataset cache layer (cache.ts) creates the buildings row lazily on the
  // first dataset write with empty meta. That leaves buildings.address = '' for
  // the lifetime of the cache, which breaks the SEO archive (/v1/building/:bbl
  // returns address = '', JSON-LD `name` is empty, OG image fallback to BBL).
  // After geocoding succeeds we have the canonical address/borough — write it.
  await getDb()
    .insert(buildings)
    .values({ bbl, address: canonicalAddress, borough })
    .onConflictDoUpdate({
      target: buildings.bbl,
      set: {
        address: drizzleSql`CASE WHEN ${buildings.address} = '' THEN EXCLUDED.address ELSE ${buildings.address} END`,
        borough: drizzleSql`CASE WHEN ${buildings.borough} = '' THEN EXCLUDED.borough ELSE ${buildings.borough} END`,
      },
    });

  // ── 4. Counter check ─────────────────────────────────────────────────────────
  // Anonymous users get FREE_ANON_LIMIT lookups before we ask them to sign up.
  // Signed-in users are unlimited on the free tier.
  if (!userId) {
    const n = await timePhase('counter_check', () => countAnonLookups(anonToken));
    if (n >= LIMITS.FREE_ANON_LIMIT) {
      return {
        status: 200,
        body: {
          kind: 'signup_gate',
          message: "You've used your 3 free lookups. Create a free account to keep going.",
        },
      };
    }
  }

  // ── 5. Fetch all data in parallel ────────────────────────────────────────────
  // Single read of buildings.raw_data feeds all 6 dataset wrappers — collapses
  // what was 6 separate `SELECT raw_data ...` round-trips into one. Each
  // wrapper still owns its own TTL/decision logic via readCachedSlice.
  const rawData = await timePhase('cache_row_fetch', () => getCachedBatch(bbl));

  // Wrap the three watched datasets so they emit phase events as they
  // individually resolve. Each wrapper is also wrapped in withDeadline so a
  // single slow Socrata call can't pace the entire pipeline.
  const hpdP = getHpdViolations(bbl, rawData).then((v) => {
    emit('hpd');
    return v;
  });
  const ownerP = lookupLandlord(bbl).then((v) => {
    emit('owner');
    return v;
  });
  // HPD registrations carry the BIN; DOB complaints are BIN-keyed (Open Data
  // requires it). Fetch registrations in parallel with HPD violations + owner,
  // then run DOB once we have a BIN. findRecentLookup also rides on the same
  // parallel batch — it has no dependency on the dataset values, so running
  // it serially after Promise.all just wastes a round-trip.
  const isAddressOnlyInput = !listingUrl && !listingDescription;
  const cachedAiP = isAddressOnlyInput ? findRecentLookup(bbl) : Promise.resolve(null);
  const [hpdR, evicR, bedR, leadR, landlordR, regsR, hpdCR, three11R, cached] = await Promise.all([
    withDeadline(hpdP, DATASET_DEADLINE_MS, [], 'hpd'),
    withDeadline(getEvictions(bbl, rawData), DATASET_DEADLINE_MS, [], 'evictions'),
    withDeadline(getBedbugReports(bbl, rawData), DATASET_DEADLINE_MS, [], 'bedbug'),
    withDeadline(getLeadPaintViolations(bbl, rawData), DATASET_DEADLINE_MS, [], 'lead_paint'),
    withDeadline(
      ownerP,
      DATASET_DEADLINE_MS,
      {
        registered_owner_name: null,
        hpd_corporation_name: null,
        registration_id: null,
        head_officer_name: null,
        head_officer_business_address: null,
        watchlist_rank: null,
        last_fetched_at: new Date(0).toISOString(),
      },
      'landlord',
    ),
    withDeadline(getHpdRegistrations(bbl, rawData), DATASET_DEADLINE_MS, [], 'hpd_registrations'),
    withDeadline(getHpdComplaints(bbl), DATASET_DEADLINE_MS, [], 'hpd_complaints'),
    withDeadline(get311HousingRequests(bbl), DATASET_DEADLINE_MS, [], 'three11_housing'),
    cachedAiP,
  ]);
  const hpdV = hpdR.value;
  const evic = evicR.value;
  const bed = bedR.value;
  const lead = leadR.value;
  const landlord = landlordR.value;
  const regs = regsR.value;
  const hpdC = hpdCR.value;
  const three11 = three11R.value;
  // DOB needs the BIN that comes off HPD registrations / violations — fetch
  // sequentially after the parallel batch resolves. Still wrapped in
  // withDeadline so a slow Socrata call here doesn't stall the response.
  const bin = regs[0]?.bin ?? hpdV[0]?.bin ?? null;
  const dobR = await withDeadline(
    getDobComplaints(bbl, bin ?? undefined, rawData).then((v) => {
      emit('dob');
      return v;
    }),
    DATASET_DEADLINE_MS,
    [],
    'dob',
  );
  const dob = dobR.value;
  const partial: string[] = [];
  if (hpdR.degraded) partial.push('hpd');
  if (dobR.degraded) partial.push('dob');
  if (evicR.degraded) partial.push('evictions');
  if (bedR.degraded) partial.push('bedbug');
  if (leadR.degraded) partial.push('lead_paint');
  if (landlordR.degraded) partial.push('landlord');
  if (regsR.degraded) partial.push('hpd_registrations');
  if (hpdCR.degraded) partial.push('hpd_complaints');
  if (three11R.degraded) partial.push('three11_housing');
  if (partial.length > 0) {
    logger.warn({ partial, bbl }, 'one or more datasets timed out or failed — serving partial');
  }
  logger.debug(
    { bbl, hpd_complaints: hpdC.length, three11_housing: three11.length },
    'extra datasets fetched',
  );
  const hpdOpen = hpdV.filter((v: { currentstatus?: string }) => v.currentstatus !== 'CLOSE').length;
  const hpdClosed = hpdV.length - hpdOpen;
  const hpdBuildingId = hpdV.find((v) => v.buildingid)?.buildingid ?? regs[0]?.buildingid ?? null;
  if (cached) {
    // Step 6 still emits so the streaming animation runs to completion; the
    // 'complete' event arrives almost immediately after, naturally cutting
    // the visible AI step short.
    emit('ai');

    const persisted = await timePhase('persist', () =>
      getDb()
        .insert(buildingLookups)
        .values({
          userId: userId ?? null,
          email: userEmail ?? null,
          anonToken,
          addressInput: resolvedAddress,
          buildingBbl: bbl,
          aiSummary: cached.summary,
          aiQuestions: cached.questions,
          aiListingNotes: cached.listingNotes,
          aiListingSummary: cached.listingSummary,
          aiScoreExplanation: cached.scoreExplanation,
          aiScore: cached.score,
          aiScoreBand: cached.scoreBand,
          aiScoreFactors: cached.scoreFactors,
          // Address-only request had no scrape — record the lack of one so a
          // subsequent address-only lookup can still cache-hit on this row.
          aiScrapedListing: null,
          // Value score fields (null for address-only cache hits — no listing data)
          aiValueScore: cached.valueScore,
          aiValueBand: cached.valueBand,
          aiValueConfidence: cached.valueConfidence,
          aiValueFactors: cached.valueFactors,
          aiValueExplanation: cached.valueExplanation,
          // Marker: this row was a cache hit, no AI charge. Used by analytics
          // and a future "free hit" billing path if we want one.
          aiCostCents: 0,
        })
        .returning({ id: buildingLookups.id }),
    );
    if (userEmail && !userId) await incrementEmailCounter(userEmail, anonToken);
    logger.info(
      { totalDurationMs: Math.round((performance.now() - reqStart) * 100) / 100, bbl, cacheHit: true },
      'lookup completed',
    );

    return {
      status: 200,
      body: {
        kind: 'success',
        bbl,
        address: canonicalAddress,
        borough,
        listing_summary: cached.listingSummary,
        summary: cached.summary,
        score_explanation: cached.scoreExplanation,
        score: cached.score,
        score_band: cached.scoreBand,
        score_factors: Array.isArray(cached.scoreFactors) ? cached.scoreFactors : [],
        // AI-generated source links aren't persisted today. OverviewTab falls
        // back to static dataset URLs when this is empty — same behavior as
        // the SEO archive route on cache hit.
        indicators: [],
        questions_to_ask: Array.isArray(cached.questions) ? cached.questions : [],
        listing_notes: Array.isArray(cached.listingNotes) ? cached.listingNotes : [],
        scraped_listing: null,
        listing_unavailable: listingUnavailable || undefined,
        landlord,
        fare_check: null,
        stats: {
          hpd_violations_open: hpdOpen,
          hpd_violations_closed: hpdClosed,
          dob_complaints: dob.length,
          evictions: evic.length,
          bedbug_reports: bed.length,
          lead_flags: lead.length,
        },
        value_score: cached.valueScore,
        value_band: cached.valueBand,
        value_confidence: cached.valueConfidence,
        value_factors: Array.isArray(cached.valueFactors) ? cached.valueFactors : [],
        value_explanation: cached.valueExplanation,
        partial: partial.length > 0 ? partial : undefined,
        lookup_id: persisted[0]?.id ?? null,
        building_url: `/building/${bbl}`,
        bin,
        hpd_building_id: hpdBuildingId,
      },
    };
  }

  // ── 6. FARE check ─────────────────────────────────────────────────────────────
  // Prefer the scraped description (verbatim from the listing page) over a
  // user-pasted description, but fall back as needed.
  const listingTextForChecks =
    scrapedListing?.description ?? listingDescription ?? listingUrl ?? null;
  const fareCheck = listingTextForChecks ? checkFare({ listingText: listingTextForChecks }) : null;

  // ── 6b. Deterministic risk score (Phase 4.5) ────────────────────────────────
  // Computed in code so it's auditable + reproducible. The AI narrates this
  // score in its score_explanation but does NOT pick it.
  const scoreStart = performance.now();
  const score = computeScore({
    hpdViolationsOpen: hpdOpen,
    hpdViolationsClosed: hpdClosed,
    dobComplaints: dob.length,
    evictions: evic.length,
    bedbugReports: bed.length,
    leadFlags: lead.length,
    watchlistRank: landlord.watchlist_rank,
    fareFlag: fareCheck?.flag ?? null,
    scrapedListing: scrapedListing,
  });
  logger.info(
    { phase: 'score', durationMs: Math.round((performance.now() - scoreStart) * 100) / 100 },
    'lookup phase completed',
  );

  // ── 6c. Apartment Value Score (deterministic) ─────────────────────────────
  // Only computed when the scraped listing has rent + bedroom data and is a
  // rental listing. Address-only, building, and sale listings skip this.
  let valueScore: ValueScoreResult | null = null;
  if (
    scrapedListing &&
    scrapedListing.source_kind === 'rental' &&
    scrapedListing.monthlyRentCents != null &&
    scrapedListing.bedrooms != null
  ) {
    try {
      const comp = await getComps(borough, scrapedListing.bedrooms);
      if (comp) {
        valueScore = computeValueScore({
          monthlyRentCents: scrapedListing.monthlyRentCents,
          bedrooms: scrapedListing.bedrooms,
          squareFeet: scrapedListing.squareFeet,
          comp,
        });
        logger.info(
          { phase: 'value_score', score: valueScore.score, band: valueScore.band, confidence: valueScore.confidence },
          'lookup phase completed',
        );
      }
    } catch (e) {
      // Value score is non-critical — log and continue without it
      logger.warn({ err: String(e) }, 'value score computation failed — continuing without it');
    }
  }

  // ── 6d. Progressive payload — score + stats are ready before AI starts ─────
  // Streaming clients can render the Overview tab here while OpenAI runs.
  const stats = {
    hpd_violations_open: hpdOpen,
    hpd_violations_closed: hpdClosed,
    dob_complaints: dob.length,
    evictions: evic.length,
    bedbug_reports: bed.length,
    lead_flags: lead.length,
  };
  emitData({
    bbl,
    address: canonicalAddress,
    borough,
    score: score.score,
    score_band: score.band,
    score_factors: score.factors,
    value_score: valueScore?.score ?? null,
    value_band: valueScore?.band ?? null,
    value_confidence: valueScore?.confidence ?? null,
    landlord,
    fare_check: fareCheck,
    stats,
    bin,
    hpd_building_id: hpdBuildingId,
    partial: partial.length > 0 ? partial : undefined,
  });

  // ── 7. AI summary (with cost cap) ────────────────────────────────────────────
  // Emit `ai` BEFORE the call so the user sees the AI step activate while
  // OpenAI is actually working. The final 'complete' event implicitly ends it.
  emit('ai');
  const subject = userId
    ? ({ type: 'user_id', value: userId } as const)
    : userEmail
      ? ({ type: 'email', value: userEmail } as const)
      : ({ type: 'anon_token', value: anonToken } as const);

  let summary;
  try {
    summary = await timePhase('ai_summary', () =>
      generateSummary(
        {
          bbl,
          address: canonicalAddress,
          borough,
          hpdViolations: { open: hpdOpen, closed: hpdClosed },
          dobComplaints: dob.length,
          evictions: evic.length,
          bedbugReports: bed.length,
          leadFlags: lead.length,
          registeredOwner: landlord.registered_owner_name,
          watchlistRank: landlord.watchlist_rank,
          // Pass listing copy so the AI can generate verbatim listing_notes,
          // and the deterministic FARE flag so it can cross-reference.
          // Scraped description (verbatim from listing page) wins over user-pasted.
          listingText: scrapedListing?.description ?? listingDescription ?? null,
          fareFlag: fareCheck?.flag ?? null,
          scrapedListing: scrapedListing,
          // Phase 4.5: deterministic score handed in for narration
          score,
          // Record-level context for the at-risk-apartments callouts; capped
          // and projected by `payload-records.ts` so the prompt stays small.
          recentHpdViolations: projectHpdViolations(hpdV),
          recentHpdComplaints: projectHpdComplaints(hpdC),
          recentDobComplaints: projectDobComplaints(dob),
          recent311Complaints: project311Complaints(three11),
          // Value score for narration (null = no listing data, suppress)
          valueScore,
        },
        subject,
      ),
    );
  } catch (e) {
    if (e instanceof CostCapExceededError) {
      return {
        status: 402,
        body: { kind: 'cost_cap', message: "We've hit today's free cap. Try again tomorrow." },
      };
    }
    throw e;
  }

  // ── 8. Persist building_lookups ──────────────────────────────────────────────
  const lookupRows = await timePhase('persist', () =>
    getDb()
      .insert(buildingLookups)
      .values({
        userId: userId ?? null,
        email: userEmail ?? null,
        anonToken,
        addressInput: resolvedAddress,
        buildingBbl: bbl,
        aiSummary: summary.summary,
        // Phase 3.7 follow-up: persist the new sections so the SEO archive
        // route can return them without re-running the AI on every page view.
        aiQuestions: summary.questions_to_ask,
        aiListingNotes: summary.listing_notes,
        // Phase 4.5: persist score + AI narration so SEO archive serves them
        aiListingSummary: summary.listing_summary || null,
        aiScoreExplanation: summary.score_explanation || null,
        aiScore: score.score,
        aiScoreBand: score.band,
        aiScoreFactors: score.factors,
        // Phase 4.5 follow-up: snapshot the scraped listing so SEO route can
        // return it on cache hits (the scraped_listings table is keyed by URL,
        // not BBL, so we can't join cleanly — denormalize instead).
        aiScrapedListing: scrapedListing,
        // Apartment Value Score
        aiValueScore: valueScore?.score ?? null,
        aiValueBand: valueScore?.band ?? null,
        aiValueConfidence: valueScore?.confidence ?? null,
        aiValueFactors: valueScore?.factors ?? null,
        aiValueExplanation: summary.value_explanation || null,
        aiCostCents: summary.cost_cents,
      })
      .returning({ id: buildingLookups.id }),
  );
  const row = lookupRows[0];

  // ── 9. Increment email counter (anon tracked implicitly via building_lookups) ─
  if (userEmail && !userId) await incrementEmailCounter(userEmail, anonToken);

  logger.info(
    { totalDurationMs: Math.round((performance.now() - reqStart) * 100) / 100, bbl, cacheHit: false, partial: partial.length > 0 ? partial : undefined },
    'lookup completed',
  );

  // ── 10. Respond ──────────────────────────────────────────────────────────────
  return {
    status: 200,
    body: {
      kind: 'success',
      bbl,
      address: canonicalAddress,
      borough,
      listing_summary: summary.listing_summary,
      summary: summary.summary,
      score_explanation: summary.score_explanation,
      score: score.score,
      score_band: score.band,
      score_factors: score.factors,
      indicators: summary.indicators,
      questions_to_ask: summary.questions_to_ask,
      listing_notes: summary.listing_notes,
      scraped_listing: scrapedListing,
      listing_unavailable: listingUnavailable || undefined,
      landlord,
      fare_check: fareCheck,
      stats,
      value_score: valueScore?.score ?? null,
      value_band: valueScore?.band ?? null,
      value_confidence: valueScore?.confidence ?? null,
      value_factors: valueScore ? valueScore.factors : [],
      value_explanation: summary.value_explanation || null,
      partial: partial.length > 0 ? partial : undefined,
      lookup_id: row?.id ?? null,
      building_url: `/building/${bbl}`,
      bin,
      hpd_building_id: hpdBuildingId,
    },
  };
}

export const lookupRoute = new Hono<{
  Variables: { anonToken: string; userId?: string; userEmail?: string };
}>();

// Pre-handler body validation. Lets a malformed-JSON request fail fast with
// the standardized error envelope (handled by app.ts onError) instead of
// reaching runLookup's internal kind:'invalid_input' fallback. runLookup
// still does its own safeParse as defense-in-depth.
function validateLookupBody(input: unknown): void {
  const r = Body.safeParse(input);
  if (!r.success) throw fromZodIssues(r.error.issues);
}

/**
 * Hono middleware variant: validate the body BEFORE the rate-limit
 * middleware runs. Without this, a script POSTing malformed JSON would
 * burn the per-anon /v1/lookup quota on every rejection, since
 * rateLimitMiddleware is wired ahead of the route handler in app.ts. The
 * handler still calls validateLookupBody() directly as defense-in-depth
 * (no-op on a second pass thanks to Hono's body cache).
 */
export async function validateLookupBodyMiddleware(
  c: import('hono').Context,
  next: () => Promise<void>,
): Promise<void> {
  const input = await c.req.json().catch(() => ({}));
  validateLookupBody(input);
  await next();
}

// JSON variant — original behavior, single response. Backed by runLookup.
lookupRoute.post('/lookup', async (c) => {
  const input = await c.req.json().catch(() => ({}));
  validateLookupBody(input);
  const ctx: LookupCtx = {
    anonToken: c.get('anonToken'),
    userId: c.get('userId'),
    userEmail: c.get('userEmail'),
  };
  try {
    const r = await runLookup(input, ctx);
    // Hono's c.json type union for status is broad; our status is a narrow
    // subset of valid codes.
    return c.json(r.body as object, r.status);
  } catch (err) {
    logger.error({ err: String(err) }, 'lookup failed');
    return c.json({ kind: 'server_error', message: 'Lookup failed. Please try again.' }, 500);
  }
});

// Streaming variant — same pipeline, NDJSON output with phase events.
// Each phase boundary emits a line; the final line carries the full response.
lookupRoute.post('/lookup/stream', async (c) => {
  const input = await c.req.json().catch(() => ({}));
  validateLookupBody(input);
  const ctx: LookupCtx = {
    anonToken: c.get('anonToken'),
    userId: c.get('userId'),
    userEmail: c.get('userEmail'),
  };
  c.header('Content-Type', 'application/x-ndjson');
  c.header('Cache-Control', 'no-cache, no-transform');
  // Disable Render's reverse-proxy buffering so chunks ship immediately.
  c.header('X-Accel-Buffering', 'no');
  return stream(c, async (s) => {
    const writeLine = (obj: object) => s.write(JSON.stringify(obj) + '\n');
    try {
      const r = await runLookup(
        input,
        ctx,
        (p) => {
          // Fire-and-forget: hono/streaming buffers the write internally.
          writeLine({ event: 'phase', name: p });
        },
        (data) => {
          // Progressive payload: score + stats are ready before AI starts.
          // Different `event` value than 'phase' so existing parsers that
          // only branch on `phase | complete` ignore it.
          writeLine({ event: 'data_ready', data });
        },
      );
      await writeLine({ event: 'complete', status: r.status, response: r.body });
    } catch (err) {
      // Truly unexpected exception (DB outage etc.). Send a synthetic
      // complete event so the client always knows the stream ended.
      logger.error({ err: String(err) }, 'lookup stream failed');
      await writeLine({
        event: 'complete',
        status: 500,
        response: { kind: 'server_error', message: 'Lookup failed. Please try again.' },
      });
    }
  });
});
