// GET /v1/building/:bbl — public building data for the SEO archive.
// No auth required. Cached in buildings table; regenerates AI summary if missing.
// Used by the ISR /building/[bbl] Next.js page.

import { Hono } from 'hono';
import { getDb } from '../db/client.js';
import { buildings, buildingLookups } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { lookupLandlord } from '../data/landlord.js';
import { getHpdViolations } from '../data/datasets/hpd-violations.js';
import { getDobComplaints } from '../data/datasets/dob-complaints.js';
import { getEvictions } from '../data/datasets/evictions.js';
import { getBedbugReports } from '../data/datasets/bedbug.js';
import { getLeadPaintViolations } from '../data/datasets/lead-paint.js';
import { get311HousingRequests } from '../data/datasets/three11-housing.js';
import { getHpdComplaints } from '../data/datasets/hpd-complaints.js';
import { getHpdRegistrations } from '../data/datasets/hpd-registrations.js';
import { generateSummary, CostCapExceededError } from '../ai/summary.js';
import { isCurrentSummaryFormat } from '../ai/summary-format.js';
import { logger } from '../logger.js';
import type { LandlordRecord } from '../data/landlord.js';
import {
  projectHpdViolations,
  projectHpdComplaints,
  projectDobComplaints,
  project311Complaints,
} from '../ai/payload-records.js';

const VIOLATIONS_CAP = 100;
const COMPLAINTS_CAP = 50;
const EVICTIONS_CAP = 100;

export const buildingByBblRoute = new Hono();

function fallbackLandlord(): LandlordRecord {
  return {
    registered_owner_name: null,
    hpd_corporation_name: null,
    registration_id: null,
    head_officer_name: null,
    head_officer_business_address: null,
    watchlist_rank: null,
    last_fetched_at: new Date().toISOString(),
  };
}

async function loadForBuildingPage<T>(
  bbl: string,
  label: string,
  load: () => Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await load();
  } catch (err) {
    logger.warn({ err, bbl, label }, 'building route data source unavailable');
    return fallback;
  }
}

buildingByBblRoute.get('/building/:bbl', async (c) => {
  const bbl = c.req.param('bbl');
  if (!/^\d{10}$/.test(bbl)) return c.json({ kind: 'not_found' }, 404);

  const [b] = await getDb().select().from(buildings).where(eq(buildings.bbl, bbl)).limit(1);
  if (!b) return c.json({ kind: 'not_found' }, 404);

  // Prefer the most recent AI output already generated for this building.
  // Also pull the new questions/listing_notes columns (Phase 3.7 follow-up)
  // so cached pages get the full structured response, not just the summary text.
  const [latest] = await getDb()
    .select({
      summary: buildingLookups.aiSummary,
      questions: buildingLookups.aiQuestions,
      listingNotes: buildingLookups.aiListingNotes,
      listingSummary: buildingLookups.aiListingSummary,
      scoreExplanation: buildingLookups.aiScoreExplanation,
      score: buildingLookups.aiScore,
      scoreBand: buildingLookups.aiScoreBand,
      scoreFactors: buildingLookups.aiScoreFactors,
      scrapedListing: buildingLookups.aiScrapedListing,
      valueScore: buildingLookups.aiValueScore,
      valueBand: buildingLookups.aiValueBand,
      valueConfidence: buildingLookups.aiValueConfidence,
      valueFactors: buildingLookups.aiValueFactors,
      valueExplanation: buildingLookups.aiValueExplanation,
    })
    .from(buildingLookups)
    .where(eq(buildingLookups.buildingBbl, bbl))
    .orderBy(desc(buildingLookups.createdAt))
    .limit(1);

  // HPD registrations are needed to derive the BIN, which DOB complaints are
  // keyed by. Without it, DOB returns []. Fetch in parallel with the rest.
  const [hpdV, evic, bed, lead, landlord, regs, threeoneone, hpdC] = await Promise.all([
    loadForBuildingPage(bbl, 'hpd_violations', () => getHpdViolations(bbl), []),
    loadForBuildingPage(bbl, 'evictions', () => getEvictions(bbl), []),
    loadForBuildingPage(bbl, 'bedbug', () => getBedbugReports(bbl), []),
    loadForBuildingPage(bbl, 'lead_paint', () => getLeadPaintViolations(bbl), []),
    loadForBuildingPage(bbl, 'landlord', () => lookupLandlord(bbl), fallbackLandlord()),
    loadForBuildingPage(bbl, 'hpd_registrations', () => getHpdRegistrations(bbl), []),
    loadForBuildingPage(bbl, 'three11_housing', () => get311HousingRequests(bbl), []),
    loadForBuildingPage(bbl, 'hpd_complaints', () => getHpdComplaints(bbl), []),
  ]);
  const bin = regs[0]?.bin ?? hpdV[0]?.bin ?? null;
  const dob = await loadForBuildingPage(
    bbl,
    'dob_complaints',
    () => getDobComplaints(bbl, bin ?? undefined),
    [],
  );
  const hpdOpen = hpdV.filter((v: { currentstatus?: string }) => v.currentstatus !== 'CLOSE').length;
  const hpdClosed = hpdV.length - hpdOpen;
  const hpdBuildingId = hpdV.find((v) => v.buildingid)?.buildingid ?? regs[0]?.buildingid ?? null;

  // Skip cached AI fields from before the pattern-lede + at-risk-apartments
  // prompt rule shipped. summary, questions, and listing_notes all come from
  // the same generation call — when the summary is stale the whole row is.
  // See ai/summary-format.ts for the marker definition; the LIKE filter in
  // findRecentLookup() in routes/lookup.ts mirrors it for SQL-level filtering.
  const cachedRowIsCurrent = isCurrentSummaryFormat(latest?.summary ?? null);
  let summary = cachedRowIsCurrent ? (latest?.summary ?? null) : null;
  let listingSummary: string | null = cachedRowIsCurrent ? (latest?.listingSummary ?? null) : null;
  let scoreExplanation: string | null = cachedRowIsCurrent
    ? (latest?.scoreExplanation ?? null)
    : null;
  let indicators: Array<{ key: string; value: string; source_url: string }> = [];
  let questions_to_ask: string[] =
    cachedRowIsCurrent && Array.isArray(latest?.questions) ? (latest!.questions as string[]) : [];
  let listing_notes: Array<{ snippet: string; note: string }> =
    cachedRowIsCurrent && Array.isArray(latest?.listingNotes)
      ? (latest!.listingNotes as Array<{ snippet: string; note: string }>)
      : [];

  // If no prior summary (or the cached row is stale), generate one using the
  // SEO anon token (subject to cost cap) and persist it back. The persist is
  // critical: without it, every SEO page view of a stale building re-runs
  // gpt-4o-mini until /v1/lookup writes a fresh row.
  if (!summary) {
    try {
      const r = await generateSummary(
        {
          bbl,
          address: b.address,
          borough: b.borough,
          hpdViolations: { open: hpdOpen, closed: hpdClosed },
          dobComplaints: dob.length,
          evictions: evic.length,
          bedbugReports: bed.length,
          leadFlags: lead.length,
          registeredOwner: landlord.registered_owner_name,
          watchlistRank: landlord.watchlist_rank,
          // SEO archive doesn't have the user's listing copy.
          listingText: null,
          fareFlag: null,
          // Record-level context for the at-risk-apartments callouts.
          recentHpdViolations: projectHpdViolations(hpdV),
          recentHpdComplaints: projectHpdComplaints(hpdC),
          recentDobComplaints: projectDobComplaints(dob),
          recent311Complaints: project311Complaints(threeoneone),
        },
        { type: 'anon_token', value: `seo:${bbl}` },
      );
      summary = r.summary;
      listingSummary = r.listing_summary || null;
      scoreExplanation = r.score_explanation || null;
      indicators = r.indicators;
      questions_to_ask = r.questions_to_ask;
      listing_notes = r.listing_notes; // always [] for SEO route (no listingText)

      // Persist the regenerated row so subsequent SEO views hit cache instead
      // of re-running the AI. Score columns are deterministic and prompt-
      // independent, so we carry them over from `latest` when present (a fresh
      // /v1/lookup is responsible for recomputing them, not the SEO route).
      // anonToken is nullable in the schema; SEO origin has no user identity.
      await getDb()
        .insert(buildingLookups)
        .values({
          userId: null,
          email: null,
          anonToken: null,
          addressInput: b.address,
          buildingBbl: bbl,
          aiSummary: r.summary,
          aiQuestions: r.questions_to_ask,
          aiListingNotes: r.listing_notes,
          aiListingSummary: r.listing_summary || null,
          aiScoreExplanation: r.score_explanation || null,
          aiScore: latest?.score ?? null,
          aiScoreBand: latest?.scoreBand ?? null,
          aiScoreFactors: latest?.scoreFactors ?? null,
          aiScrapedListing: null,
          aiValueScore: null,
          aiValueBand: null,
          aiValueConfidence: null,
          aiValueFactors: null,
          aiValueExplanation: null,
          aiCostCents: r.cost_cents,
        });
    } catch (e) {
      if (e instanceof CostCapExceededError) {
        summary = 'Summary temporarily unavailable due to daily generation limits.';
      } else {
        throw e;
      }
    }
  }

  return c.json({
    kind: 'success',
    bbl,
    address: b.address,
    borough: b.borough,
    listing_summary: listingSummary,
    summary,
    score_explanation: scoreExplanation,
    score: latest?.score ?? null,
    score_band: latest?.scoreBand ?? null,
    score_factors: Array.isArray(latest?.scoreFactors) ? latest!.scoreFactors : [],
    indicators,
    questions_to_ask,
    listing_notes,
    // Phase 4.5 follow-up: hydrate from the snapshotted column when present
    scraped_listing: latest?.scrapedListing ?? null,
    value_score: latest?.valueScore ?? null,
    value_band: latest?.valueBand ?? null,
    value_confidence: latest?.valueConfidence ?? null,
    value_factors: Array.isArray(latest?.valueFactors) ? latest!.valueFactors : [],
    value_explanation: latest?.valueExplanation ?? null,
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
    lookup_id: '',
    building_url: `/building/${bbl}`,
    bin,
    hpd_building_id: hpdBuildingId,
    violations_rows: hpdV.slice(0, VIOLATIONS_CAP).map((v) => ({
      violationid: v.violationid,
      class: v.class,
      novissueddate: v.novissueddate,
      inspectiondate: v.inspectiondate,
      currentstatus: v.currentstatus,
      currentstatusdate: v.currentstatusdate,
      novdescription: v.novdescription,
      apartment: v.apartment,
    })),
    complaints_rows: {
      dob: dob.slice(0, COMPLAINTS_CAP).map((d) => ({
        complaint_number: d.complaint_number,
        complaint_category: d.complaint_category,
        date_entered: d.date_entered,
        status: d.status,
        disposition_code: d.disposition_code,
        disposition_date: d.disposition_date,
      })),
      threeoneone: threeoneone.slice(0, COMPLAINTS_CAP).map((t) => ({
        unique_key: t.unique_key,
        created_date: t.created_date,
        agency: t.agency,
        complaint_type: t.complaint_type,
        descriptor: t.descriptor,
        status: t.status,
      })),
      hpd_complaints: hpdC.slice(0, COMPLAINTS_CAP).map((c) => ({
        complaintid: c.complaintid,
        apartment: c.apartment,
        receiveddate: c.receiveddate,
        status: c.status,
        statusdate: c.statusdate,
      })),
    },
    evictions_rows: evic.slice(0, EVICTIONS_CAP).map((e) => ({
      court_index_number: e.court_index_number,
      executed_date: e.executed_date,
      eviction_address: e.eviction_address,
      eviction_apt_num: e.eviction_apt_num,
      residential_commercial_ind: e.residential_commercial_ind,
    })),
    total_counts: {
      violations: hpdV.length,
      dob: dob.length,
      threeoneone: threeoneone.length,
      hpd_complaints: hpdC.length,
      evictions: evic.length,
    },
    has_more: {
      violations: hpdV.length > VIOLATIONS_CAP,
      dob: dob.length > COMPLAINTS_CAP,
      threeoneone: threeoneone.length > COMPLAINTS_CAP,
      hpd_complaints: hpdC.length > COMPLAINTS_CAP,
      evictions: evic.length > EVICTIONS_CAP,
    },
  });
});
