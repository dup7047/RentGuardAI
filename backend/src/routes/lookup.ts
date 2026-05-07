// POST /v1/lookup — master endpoint for Phase 3.
// Composes: URL parse → geocode → counter check → data fetch →
//           FARE check → AI summary (with cost cap) → persist → respond.

import { Hono } from 'hono';
import { z } from 'zod';
import { parseListingUrl } from '../parse/listing-url.js';
import { geosearch } from '../geo/geosearch.js';
import { lookupLandlord } from '../data/landlord.js';
import { checkFare } from '../fare/check.js';
import { generateSummary, CostCapExceededError } from '../ai/summary.js';
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

export const lookupRoute = new Hono<{
  Variables: { anonToken: string; userId?: string; userEmail?: string };
}>();

lookupRoute.post('/lookup', async (c) => {
  // ── 1. Parse + validate body ────────────────────────────────────────────────
  const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success)
    return c.json({ kind: 'invalid_input', errors: parsed.error.flatten() }, 400);

  const { address, listingUrl, listingDescription, email } = parsed.data;
  const anonToken = c.get('anonToken');
  const userId = c.get('userId');
  const userEmail = c.get('userEmail') ?? email;

  // ── 2. URL parse ─────────────────────────────────────────────────────────────
  let resolvedAddress = address;
  if (listingUrl && !resolvedAddress) {
    const r = parseListingUrl(listingUrl);
    if (r.kind === 'requires_address')
      return c.json({ kind: 'requires_address', reason: r.reason });
    resolvedAddress = r.address;
  }
  if (!resolvedAddress)
    return c.json({ kind: 'invalid_input', errors: { address: 'required' } }, 400);

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
    return c.json({
      kind: 'outside_nyc',
      detected_city: g.detected_city,
      detected_state: g.detected_state,
    });
  }
  if (g.kind === 'ambiguous') return c.json({ kind: 'ambiguous', matches: g.matches });

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
      if (n >= LIMITS.FREE_ANON_LIMIT)
        return c.json({ kind: 'email_gate', message: 'Drop your email to keep looking.' });
    } else {
      const n = await countEmailLookups(userEmail);
      if (n >= LIMITS.FREE_EMAIL_LIMIT_30D)
        return c.json({
          kind: 'email_gate',
          message: 'You have used your 3 free lookups this month.',
        });
    }
  }

  // ── 5. Fetch all data in parallel ────────────────────────────────────────────
  const [hpdV, dob, evic, bed, lead, landlord] = await Promise.all([
    getHpdViolations(bbl),
    getDobComplaints(bbl),
    getEvictions(bbl),
    getBedbugReports(bbl),
    getLeadPaintViolations(bbl),
    lookupLandlord(bbl),
  ]);
  const hpdOpen = hpdV.filter((v: { currentstatus?: string }) => v.currentstatus !== 'CLOSE').length;
  const hpdClosed = hpdV.length - hpdOpen;

  // ── 6. FARE check ─────────────────────────────────────────────────────────────
  const fareCheck =
    listingUrl || listingDescription
      ? checkFare({ listingText: listingDescription ?? listingUrl })
      : null;

  // ── 7. AI summary (with cost cap) ────────────────────────────────────────────
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
        listingText: listingDescription ?? null,
        fareFlag: fareCheck?.flag ?? null,
      },
      subject,
    );
  } catch (e) {
    if (e instanceof CostCapExceededError) {
      return c.json(
        { kind: 'cost_cap', message: "We've hit today's free cap — try again tomorrow." },
        402,
      );
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
      aiCostCents: summary.cost_cents,
    })
    .returning({ id: buildingLookups.id });
  const row = lookupRows[0];

  // ── 9. Increment email counter (anon tracked implicitly via building_lookups) ─
  if (userEmail && !userId) await incrementEmailCounter(userEmail, anonToken);

  // ── 10. Respond ──────────────────────────────────────────────────────────────
  return c.json({
    kind: 'success',
    bbl,
    address: canonicalAddress,
    borough,
    summary: summary.summary,
    indicators: summary.indicators,
    questions_to_ask: summary.questions_to_ask,
    listing_notes: summary.listing_notes,
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
  });
});
