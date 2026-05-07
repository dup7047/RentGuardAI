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
import { geosearch } from '../geo/geosearch.js';
import { lookupLandlord } from '../data/landlord.js';
import { checkFare } from '../fare/check.js';
import { generateSummary, CostCapExceededError } from '../ai/summary.js';
import { computeScore } from '../scoring/score.js';
import { getHpdViolations } from '../data/datasets/hpd-violations.js';
import { getDobComplaints } from '../data/datasets/dob-complaints.js';
import { getEvictions } from '../data/datasets/evictions.js';
import { getBedbugReports } from '../data/datasets/bedbug.js';
import { getLeadPaintViolations } from '../data/datasets/lead-paint.js';
import { getHpdRegistrations } from '../data/datasets/hpd-registrations.js';
import { getCachedBatch } from '../data/cache.js';
import { getDb } from '../db/client.js';
import { buildingLookups, buildings, nonNycWaitlist } from '../db/schema.js';
import { and, desc, eq, gt, isNotNull, isNull, sql as drizzleSql } from 'drizzle-orm';
import { LIMITS, countAnonLookups, countEmailLookups, incrementEmailCounter } from '../lib/counters.js';
import { logger } from '../logger.js';
import type { Borough } from '../data/types.js';

const Body = z
  .object({
    address: z.string().optional(),
    listingUrl: z.string().optional(),
    listingDescription: z.string().optional(),
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

/** Race a promise against a deadline. On timeout, resolves with the fallback
 *  value and `timedOut: true`; the underlying promise keeps running but its
 *  result is discarded. Used to cap dataset fan-out tail latency. */
function withDeadline<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
): Promise<{ value: T; timedOut: boolean }> {
  let to: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ value: T; timedOut: boolean }>((resolve) => {
    to = setTimeout(() => resolve({ value: fallback, timedOut: true }), ms);
  });
  const settled = p
    .then((value) => ({ value, timedOut: false }))
    .catch(() => ({ value: fallback, timedOut: false }));
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

  const { address, listingUrl, listingDescription, email, bbl: providedBbl } = parsed.data;
  const { anonToken, userId } = ctx;
  const userEmail = ctx.userEmail ?? email;

  // ── 2. URL fetch + extract (Phase 4 — replaces the slug-only parser) ────────
  let resolvedAddress = address;
  let scrapedListing: ScrapedListing | null = null;
  if (listingUrl && !resolvedAddress) {
    const r = await timePhase('scrape', () => scrapeListing(listingUrl));
    if (r.kind === 'error') {
      // 'listing_blocked' is recoverable if the user pasted a description and address
      // (defensive — the current LookupForm sends address+url together on retry,
      // which means we don't hit this branch in practice; preserved for safety).
      if (r.code === 'listing_blocked' && listingDescription && address) {
        resolvedAddress = address;
        emit('parse');
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
  // suggestion, skip the GeoSearch round-trip. We still need a canonical
  // address + borough for the response and downstream prompt; pull them from
  // the cached buildings row when present, fall back to user input otherwise.
  let bbl: string;
  let canonicalAddress: string;
  let borough: Borough;
  if (providedBbl) {
    bbl = providedBbl;
    const [b] = await getDb()
      .select({ address: buildings.address, borough: buildings.borough })
      .from(buildings)
      .where(eq(buildings.bbl, providedBbl))
      .limit(1);
    canonicalAddress = b?.address && b.address.length > 0 ? b.address : resolvedAddress;
    borough = ((b?.borough && b.borough.length > 0 ? b.borough : 'MANHATTAN') as Borough);
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
      return { status: 200, body: { kind: 'ambiguous', matches: g.matches } };
    }
    bbl = g.bbl;
    canonicalAddress = g.address;
    borough = g.borough;
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
  if (!userId) {
    if (!userEmail) {
      const n = await timePhase('counter_check', () => countAnonLookups(anonToken));
      if (n >= LIMITS.FREE_ANON_LIMIT) {
        return {
          status: 200,
          body: { kind: 'email_gate', message: 'Drop your email to keep looking.' },
        };
      }
    } else {
      const n = await timePhase('counter_check', () => countEmailLookups(userEmail));
      if (n >= LIMITS.FREE_EMAIL_LIMIT_30D) {
        return {
          status: 200,
          body: {
            kind: 'email_gate',
            message: 'You have used your 3 free lookups this month.',
          },
        };
      }
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
  const [hpdR, evicR, bedR, leadR, landlordR, regsR, cached] = await Promise.all([
    withDeadline(hpdP, DATASET_DEADLINE_MS, []),
    withDeadline(getEvictions(bbl, rawData), DATASET_DEADLINE_MS, []),
    withDeadline(getBedbugReports(bbl, rawData), DATASET_DEADLINE_MS, []),
    withDeadline(getLeadPaintViolations(bbl, rawData), DATASET_DEADLINE_MS, []),
    withDeadline(ownerP, DATASET_DEADLINE_MS, {
      registered_owner_name: null,
      hpd_corporation_name: null,
      registration_id: null,
      head_officer_name: null,
      head_officer_business_address: null,
      watchlist_rank: null,
      last_fetched_at: new Date(0).toISOString(),
    }),
    withDeadline(getHpdRegistrations(bbl, rawData), DATASET_DEADLINE_MS, []),
    cachedAiP,
  ]);
  const hpdV = hpdR.value;
  const evic = evicR.value;
  const bed = bedR.value;
  const lead = leadR.value;
  const landlord = landlordR.value;
  const regs = regsR.value;
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
  );
  const dob = dobR.value;
  const partial: string[] = [];
  if (hpdR.timedOut) partial.push('hpd');
  if (dobR.timedOut) partial.push('dob');
  if (evicR.timedOut) partial.push('evictions');
  if (bedR.timedOut) partial.push('bedbug');
  if (leadR.timedOut) partial.push('lead_paint');
  if (landlordR.timedOut) partial.push('landlord');
  if (regsR.timedOut) partial.push('hpd_registrations');
  if (partial.length > 0) {
    logger.warn({ partial, bbl }, 'one or more datasets timed out — serving partial');
  }
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

  // ── 6c. Progressive payload — score + stats are ready before AI starts ─────
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
        },
        subject,
      ),
    );
  } catch (e) {
    if (e instanceof CostCapExceededError) {
      return {
        status: 402,
        body: { kind: 'cost_cap', message: "We've hit today's free cap — try again tomorrow." },
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
      landlord,
      fare_check: fareCheck,
      stats,
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

// JSON variant — original behavior, single response. Backed by runLookup.
lookupRoute.post('/lookup', async (c) => {
  const input = await c.req.json().catch(() => ({}));
  const ctx: LookupCtx = {
    anonToken: c.get('anonToken'),
    userId: c.get('userId'),
    userEmail: c.get('userEmail'),
  };
  const r = await runLookup(input, ctx);
  // Hono's c.json type union for status is broad; our status is a narrow
  // subset of valid codes.
  return c.json(r.body as object, r.status);
});

// Streaming variant — same pipeline, NDJSON output with phase events.
// Each phase boundary emits a line; the final line carries the full response.
lookupRoute.post('/lookup/stream', async (c) => {
  const input = await c.req.json().catch(() => ({}));
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
    } catch {
      // Truly unexpected exception (DB outage etc.). Send a synthetic
      // complete event so the client always knows the stream ended.
      await writeLine({
        event: 'complete',
        status: 500,
        response: { kind: 'invalid_input', errors: { _: 'server_error' } },
      });
    }
  });
});
