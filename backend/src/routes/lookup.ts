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
import { getDb } from '../db/client.js';
import { buildingLookups, buildings, nonNycWaitlist } from '../db/schema.js';
import { sql as drizzleSql } from 'drizzle-orm';
import { LIMITS, countAnonLookups, countEmailLookups, incrementEmailCounter } from '../lib/counters.js';

const Body = z
  .object({
    address: z.string().optional(),
    listingUrl: z.string().optional(),
    listingDescription: z.string().optional(),
    email: z.string().email().optional(),
  })
  .refine((d) => d.address || d.listingUrl, { message: 'address or listingUrl required' });

export type LookupPhase = 'parse' | 'geo' | 'hpd' | 'dob' | 'owner' | 'ai';

export type LookupCtx = {
  anonToken: string;
  userId?: string;
  userEmail?: string;
};

type LookupStatus = 200 | 400 | 402 | 404;
export type LookupResult = { status: LookupStatus; body: unknown };

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
): Promise<LookupResult> {
  // ── 1. Parse + validate body ────────────────────────────────────────────────
  const parsed = Body.safeParse(input);
  if (!parsed.success) {
    return { status: 400, body: { kind: 'invalid_input', errors: parsed.error.flatten() } };
  }

  const { address, listingUrl, listingDescription, email } = parsed.data;
  const { anonToken, userId } = ctx;
  const userEmail = ctx.userEmail ?? email;

  // ── 2. URL fetch + extract (Phase 4 — replaces the slug-only parser) ────────
  let resolvedAddress = address;
  let scrapedListing: ScrapedListing | null = null;
  if (listingUrl && !resolvedAddress) {
    const r = await scrapeListing(listingUrl);
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
  const g = await geosearch(resolvedAddress);
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

  // Geo succeeded — emit only on the success path. Outside-NYC and ambiguous
  // are dead-ends; emitting `geo` for them would be misleading on the UI.
  emit('geo');

  const { bbl, address: canonicalAddress, borough } = g;

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
      const n = await countAnonLookups(anonToken);
      if (n >= LIMITS.FREE_ANON_LIMIT) {
        return {
          status: 200,
          body: { kind: 'email_gate', message: 'Drop your email to keep looking.' },
        };
      }
    } else {
      const n = await countEmailLookups(userEmail);
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
  // Wrap the three watched datasets so they emit phase events as they
  // individually resolve. Promise.all still waits for ALL six — we just
  // hook into the resolution of three of them.
  const hpdP = getHpdViolations(bbl).then((v) => {
    emit('hpd');
    return v;
  });
  const dobP = getDobComplaints(bbl).then((v) => {
    emit('dob');
    return v;
  });
  const ownerP = lookupLandlord(bbl).then((v) => {
    emit('owner');
    return v;
  });
  const [hpdV, dob, evic, bed, lead, landlord] = await Promise.all([
    hpdP,
    dobP,
    getEvictions(bbl),
    getBedbugReports(bbl),
    getLeadPaintViolations(bbl),
    ownerP,
  ]);
  const hpdOpen = hpdV.filter((v: { currentstatus?: string }) => v.currentstatus !== 'CLOSE').length;
  const hpdClosed = hpdV.length - hpdOpen;

  // ── 6. FARE check ─────────────────────────────────────────────────────────────
  // Prefer the scraped description (verbatim from the listing page) over a
  // user-pasted description, but fall back as needed.
  const listingTextForChecks =
    scrapedListing?.description ?? listingDescription ?? listingUrl ?? null;
  const fareCheck = listingTextForChecks ? checkFare({ listingText: listingTextForChecks }) : null;

  // ── 6b. Deterministic risk score (Phase 4.5) ────────────────────────────────
  // Computed in code so it's auditable + reproducible. The AI narrates this
  // score in its score_explanation but does NOT pick it.
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
    summary = await generateSummary(
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
  const lookupRows = await getDb()
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
    .returning({ id: buildingLookups.id });
  const row = lookupRows[0];

  // ── 9. Increment email counter (anon tracked implicitly via building_lookups) ─
  if (userEmail && !userId) await incrementEmailCounter(userEmail, anonToken);

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
      stats: {
        hpd_violations_open: hpdOpen,
        hpd_violations_closed: hpdClosed,
        dob_complaints: dob.length,
        evictions: evic.length,
        bedbug_reports: bed.length,
        lead_flags: lead.length,
      },
      lookup_id: row?.id ?? null,
      building_url: `/building/${bbl}`,
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
      const r = await runLookup(input, ctx, (p) => {
        // Fire-and-forget: hono/streaming buffers the write internally.
        writeLine({ event: 'phase', name: p });
      });
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
