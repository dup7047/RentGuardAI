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
import { generateSummary, CostCapExceededError } from '../ai/summary.js';

export const buildingByBblRoute = new Hono();

buildingByBblRoute.get('/building/:bbl', async (c) => {
  const bbl = c.req.param('bbl');
  if (!/^\d{10}$/.test(bbl)) return c.json({ kind: 'not_found' }, 404);

  const [b] = await getDb().select().from(buildings).where(eq(buildings.bbl, bbl)).limit(1);
  if (!b) return c.json({ kind: 'not_found' }, 404);

  // Prefer the most recent AI summary already generated for this building
  const [latest] = await getDb()
    .select({ summary: buildingLookups.aiSummary })
    .from(buildingLookups)
    .where(eq(buildingLookups.buildingBbl, bbl))
    .orderBy(desc(buildingLookups.createdAt))
    .limit(1);

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

  let summary = latest?.summary ?? null;
  let indicators: Array<{ key: string; value: string; source_url: string }> = [];

  // If no prior summary, generate one using the SEO anon token (subject to cost cap)
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
        },
        { type: 'anon_token', value: `seo:${bbl}` },
      );
      summary = r.summary;
      indicators = r.indicators;
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
    summary,
    indicators,
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
  });
});
