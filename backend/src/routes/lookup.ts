// The lookup pipeline: URL parse → geocode → counter check → data fetch →
// FARE check → AI summary (cost-capped) → persist → respond.
// `runLookup` is shared by POST /v1/lookup (JSON) and /v1/lookup/stream
// (NDJSON phase events) so the two responses cannot drift.

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

// Reject `<`, `>`, quotes, and control characters at the API edge so nothing
// shaped like `</script>…` can reach buildings.address, which is rendered
// inside a JSON-LD <script> block on the SEO archive.
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
    // Pre-resolved BBL from the frontend's autocomplete pick — skips the
    // GeoSearch round-trip. Falls back to geocoding on any inconsistency.
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

/** Race a promise against a deadline. Timeouts AND rejections resolve with
 *  the fallback and `degraded: true` so a failed dataset surfaces as partial
 *  data instead of silently rendering as "no records". Exported for tests. */
export function withDeadline<T>(
  p: Promise<T>,
  ms: number,
  fallback: T,
  label?: string,
): Promise<{ value: T; degraded: boolean; label?: string }> {
  let to: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ value: T; degraded: boolean; label?: string }>((resolve) => {
    to = setTimeout(() => resolve({ value: fallback, degraded: true, label }), ms);
  });
  const settled = p
    .then((value) => ({ value, degraded: false, label }))
    .catch((e) => {
      logger.warn({ err: String(e), label }, 'dataset fetch failed — serving fallback');
      return { value: fallback, degraded: true, label };
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

/**
 * Assemble the `kind: 'success'` response body. Both the cache-hit and
 * fresh-AI paths return this exact shape — building it in one place keeps
 * the two from drifting. Array-ish fields tolerate unknown JSONB values
 * because the cache-hit path reads them straight from persisted columns.
 */
function successBody(fields: {
  bbl: string;
  address: string;
  borough: Borough;
  listing_summary: string | null;
  summary: string;
  score_explanation: string | null;
  score: number;
  score_band: string;
  score_factors: unknown;
  /** AI source links; [] on cache hits (not persisted today — OverviewTab
   *  falls back to static dataset URLs, same as the SEO archive route). */
  indicators: unknown[];
  questions_to_ask: unknown;
  listing_notes: unknown;
  scraped_listing: ScrapedListing | null;
  listing_unavailable: boolean;
  landlord: unknown;
  fare_check: unknown;
  stats: Record<string, number>;
  value_score: number | null;
  value_band: string | null;
  value_confidence: string | null;
  value_factors: unknown;
  value_explanation: string | null;
  partial: string[];
  lookup_id: string | null;
  bin: string | null;
  hpd_building_id: string | null;
}) {
  return {
    kind: 'success' as const,
    ...fields,
    score_factors: Array.isArray(fields.score_factors) ? fields.score_factors : [],
    questions_to_ask: Array.isArray(fields.questions_to_ask) ? fields.questions_to_ask : [],
    listing_notes: Array.isArray(fields.listing_notes) ? fields.listing_notes : [],
    value_factors: Array.isArray(fields.value_factors) ? fields.value_factors : [],
    listing_unavailable: fields.listing_unavailable || undefined,
    partial: fields.partial.length > 0 ? fields.partial : undefined,
    building_url: `/building/${fields.bbl}`,
  };
}

// Cache-hit short-circuit: address-only lookups for a BBL summarized in the
// last 24h reuse the persisted AI fields. Same TTL as the dataset cache so
// the two stay internally consistent.

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
  // Only present for URL-based lookups with rent data.
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
        // Rows missing both required prompt markers are old-format and must
        // be regenerated even inside the TTL. If you change the prompt's
        // markers, update these patterns (mirrored in summary-format.ts).
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
 * Runs the lookup pipeline (no Hono Context coupling). Known failure modes
 * return `{ status, body }`; only truly unexpected exceptions throw.
 *
 * Phase emit semantics:
 *   - `parse`: after a successful scrape or immediately when none is needed;
 *              skipped on scrape errors that abort the pipeline.
 *   - `geo`  : only when geocoding yields a usable BBL (not for the
 *              outside_nyc / ambiguous dead-ends).
 *   - `hpd` / `dob` / `owner`: when the respective dataset resolves.
 *   - `ai`   : BEFORE generateSummary so the UI shows "AI is working".
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

  // `let`: the slug-parse fallback clears it so the rest of the pipeline
  // treats the request as address-only when the page couldn't be scraped.
  // eslint-disable-next-line prefer-const -- intentional mutation below
  let { listingUrl } = parsed.data;
  const { address, listingDescription, email, bbl: providedBbl } = parsed.data;
  const { anonToken, userId } = ctx;
  const userEmail = ctx.userEmail ?? email;

  // ── 2. URL fetch + extract ──────────────────────────────────────────────────
  let resolvedAddress = address;
  let scrapedListing: ScrapedListing | null = null;
  // Set on the slug-parse recovery path so the UI can say the review covers
  // public records only (no listing-specific fields).
  let listingUnavailable = false;
  if (listingUrl && !resolvedAddress) {
    // Capture in a const so the closure passed to timePhase doesn't see the
    // post-slug-parse `listingUrl = undefined` reassignment below.
    const scrapeUrl = listingUrl;
    const r = await timePhase('scrape', () => scrapeListing(scrapeUrl));
    if (r.kind === 'error') {
      // Defensive: the current LookupForm sends address+url together on retry,
      // so this branch is not hit in practice.
      if (r.code === 'listing_blocked' && listingDescription && address) {
        resolvedAddress = address;
        emit('parse');
      } else if (r.code === 'listing_blocked' || r.code === 'listing_expired') {
        // Slug-parse fallback: most listing URLs carry the address in the
        // path. Route as address-only so the user still gets a building
        // report instead of the manual-paste form.
        const detect = detectListingHost(listingUrl);
        const canonical = canonicalizeListingUrl(listingUrl);
        const fromSlug = detect ? parseAddressFromUrl(canonical, detect.source) : null;
        if (fromSlug) {
          logger.info(
            { source: detect!.source, url: canonical, parsedAddress: fromSlug },
            'slug-parse fallback hit — routing as address-only',
          );
          resolvedAddress = fromSlug;
          // Clear listingUrl so the AI cache short-circuit treats this as an
          // address-only lookup (and the row stays cache-hit eligible).
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
    // No scrape needed (address-only, or URL+address retry) — parse is done.
    emit('parse');
  }
  if (!resolvedAddress) {
    return { status: 400, body: { kind: 'invalid_input', errors: { address: 'required' } } };
  }

  // ── 3. Geocode ───────────────────────────────────────────────────────────────
  // Fast path: a forwarded autocomplete BBL with a cached canonical
  // address+borough skips GeoSearch. On first sighting we must geocode —
  // trusting the user-supplied address would let it land verbatim in
  // buildings.address, which is rendered into JSON-LD on the SEO archive.
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
      // A BBL forwarded from the disambiguation picker resolves the tie
      // directly — re-geocoding the picked label returns the same tie forever
      // for hyphenated Queens addresses. Address/borough come from OUR
      // geosearch match, never the untrusted override.
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

  emit('geo');

  // ── 3b. Upsert canonical address/borough on buildings row ───────────────────
  // The dataset cache creates the buildings row lazily with empty meta; without
  // this write the SEO archive serves address = '' for the cache's lifetime.
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

  // ── 4. Counter check — anon users get FREE_ANON_LIMIT, signed-in unlimited ──
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
  // One buildings.raw_data read feeds every dataset wrapper; each wrapper
  // still owns its own TTL logic via readCachedSlice.
  const rawData = await timePhase('cache_row_fetch', () => getCachedBatch(bbl));

  // These two emit phase events as they resolve.
  const hpdP = getHpdViolations(bbl, rawData).then((v) => {
    emit('hpd');
    return v;
  });
  const ownerP = lookupLandlord(bbl).then((v) => {
    emit('owner');
    return v;
  });
  // DOB complaints are BIN-keyed and the BIN comes from HPD registrations,
  // so DOB runs after this batch. findRecentLookup rides along — it has no
  // dependency on the dataset values.
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
  const partial = [hpdR, dobR, evicR, bedR, leadR, landlordR, regsR, hpdCR, three11R]
    .filter((r) => r.degraded)
    .map((r) => r.label!);
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
  const stats = {
    hpd_violations_open: hpdOpen,
    hpd_violations_closed: hpdClosed,
    dob_complaints: dob.length,
    evictions: evic.length,
    bedbug_reports: bed.length,
    lead_flags: lead.length,
  };
  if (cached) {
    // Emit so the streaming animation runs to completion; 'complete' follows
    // almost immediately and cuts the visible AI step short.
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
          // Null keeps this row cache-hit eligible for future address-only lookups.
          aiScrapedListing: null,
          aiValueScore: cached.valueScore,
          aiValueBand: cached.valueBand,
          aiValueConfidence: cached.valueConfidence,
          aiValueFactors: cached.valueFactors,
          aiValueExplanation: cached.valueExplanation,
          // 0 marks a cache hit (no AI charge) for analytics.
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
      body: successBody({
        bbl,
        address: canonicalAddress,
        borough,
        listing_summary: cached.listingSummary,
        summary: cached.summary,
        score_explanation: cached.scoreExplanation,
        score: cached.score,
        score_band: cached.scoreBand,
        score_factors: cached.scoreFactors,
        indicators: [],
        questions_to_ask: cached.questions,
        listing_notes: cached.listingNotes,
        scraped_listing: null,
        listing_unavailable: listingUnavailable,
        landlord,
        fare_check: null,
        stats,
        value_score: cached.valueScore,
        value_band: cached.valueBand,
        value_confidence: cached.valueConfidence,
        value_factors: cached.valueFactors,
        value_explanation: cached.valueExplanation,
        partial,
        lookup_id: persisted[0]?.id ?? null,
        bin,
        hpd_building_id: hpdBuildingId,
      }),
    };
  }

  // ── 6. FARE check — scraped description wins over user-pasted ───────────────
  const listingTextForChecks =
    scrapedListing?.description ?? listingDescription ?? listingUrl ?? null;
  const fareCheck = listingTextForChecks ? checkFare({ listingText: listingTextForChecks }) : null;

  // ── 6b. Deterministic risk score — computed in code so it's auditable and
  // reproducible; the AI narrates it but does NOT pick it ─────────────────────
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

  // ── 6c. Apartment Value Score — rental listings with rent + beds only ──────
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
      logger.warn({ err: String(e) }, 'value score computation failed — continuing without it');
    }
  }

  // ── 6d. Progressive payload — streaming clients can render the Overview tab
  // while OpenAI runs ─────────────────────────────────────────────────────────
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

  // ── 7. AI summary (with cost cap) — emit BEFORE the call so the AI step
  // activates while OpenAI is actually working ────────────────────────────────
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
          // Verbatim listing copy for listing_notes; scraped wins over pasted.
          listingText: scrapedListing?.description ?? listingDescription ?? null,
          fareFlag: fareCheck?.flag ?? null,
          scrapedListing: scrapedListing,
          // Deterministic score handed in for narration only.
          score,
          // Record-level context, capped by payload-records.ts to keep the prompt small.
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
        aiQuestions: summary.questions_to_ask,
        aiListingNotes: summary.listing_notes,
        aiListingSummary: summary.listing_summary || null,
        aiScoreExplanation: summary.score_explanation || null,
        aiScore: score.score,
        aiScoreBand: score.band,
        aiScoreFactors: score.factors,
        // Denormalized snapshot: scraped_listings is keyed by URL, not BBL, so
        // the SEO route can't join cleanly on cache hits.
        aiScrapedListing: scrapedListing,
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
    body: successBody({
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
      listing_unavailable: listingUnavailable,
      landlord,
      fare_check: fareCheck,
      stats,
      value_score: valueScore?.score ?? null,
      value_band: valueScore?.band ?? null,
      value_confidence: valueScore?.confidence ?? null,
      value_factors: valueScore?.factors ?? null,
      value_explanation: summary.value_explanation || null,
      partial,
      lookup_id: row?.id ?? null,
      bin,
      hpd_building_id: hpdBuildingId,
    }),
  };
}

export const lookupRoute = new Hono<{
  Variables: { anonToken: string; userId?: string; userEmail?: string };
}>();

// Fail fast with the standardized error envelope; runLookup still does its
// own safeParse as defense-in-depth.
function validateLookupBody(input: unknown): void {
  const r = Body.safeParse(input);
  if (!r.success) throw fromZodIssues(r.error.issues);
}

/**
 * Runs BEFORE the rate-limit middleware (see app.ts) so malformed-JSON spam
 * cannot burn the per-anon quota.
 */
export async function validateLookupBodyMiddleware(
  c: import('hono').Context,
  next: () => Promise<void>,
): Promise<void> {
  const input = await c.req.json().catch(() => ({}));
  validateLookupBody(input);
  await next();
}

// JSON variant — single response.
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
    return c.json(r.body as object, r.status);
  } catch (err) {
    logger.error({ err: String(err) }, 'lookup failed');
    return c.json({ kind: 'server_error', message: 'Lookup failed. Please try again.' }, 500);
  }
});

// Streaming variant — NDJSON phase events, final line carries the response.
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
          writeLine({ event: 'phase', name: p });
        },
        (data) => {
          // Distinct event name so parsers that only know phase|complete ignore it.
          writeLine({ event: 'data_ready', data });
        },
      );
      await writeLine({ event: 'complete', status: r.status, response: r.body });
    } catch (err) {
      // Synthetic complete event so the client always knows the stream ended.
      logger.error({ err: String(err) }, 'lookup stream failed');
      await writeLine({
        event: 'complete',
        status: 500,
        response: { kind: 'server_error', message: 'Lookup failed. Please try again.' },
      });
    }
  });
});
