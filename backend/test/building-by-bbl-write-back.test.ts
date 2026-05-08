// Phase F2 regression test — when /v1/building/:bbl finds a stale-format
// row in building_lookups, it must:
//  (1) Skip the cached aiSummary text (pre-PR-#15 4-dataset walkthrough)
//  (2) Call generateSummary fresh
//  (3) INSERT a new building_lookups row carrying the fresh summary forward
//
// Without (3), every SEO page view of a stale building re-runs gpt-4o-mini.
//
// Mocking pattern mirrors lookup-cache.test.ts: vi.hoisted for the in-process
// state, vi.mock for every external dep, then exercise the route via createApp.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    latestRow: null as Record<string, unknown> | null,
    insertedRows: [] as Record<string, unknown>[],
    generateSummaryFn: vi.fn(),
  },
}));

vi.mock('../src/db/client.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        mocks.insertedRows.push(v);
        return {
          onConflictDoNothing: async () => undefined,
          onConflictDoUpdate: async () => undefined,
          returning: async () => [{ id: 'fake-id' }],
        };
      },
    }),
    select: (cols?: Record<string, unknown>) => {
      // Two SELECT shapes hit this route:
      //   1. buildings (no `cols` arg in the production code path) — must
      //      return the matching building so we don't 404.
      //   2. buildingLookups (called with explicit columns) — returns the
      //      controllable `latestRow`.
      const isBuildingsLookup = !cols;
      return {
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => (mocks.latestRow ? [mocks.latestRow] : []),
            }),
            limit: async () =>
              isBuildingsLookup ? [{ bbl: '1007430026', address: '325 W 19 ST', borough: 'MANHATTAN' }] : [],
          }),
        }),
      };
    },
  }),
  getPool: () => ({ query: async () => ({ rows: [] }) }),
}));

vi.mock('../src/data/landlord.js', () => ({
  lookupLandlord: vi.fn().mockResolvedValue({
    registered_owner_name: 'Test Owner LLC',
    watchlist_rank: null,
    hpd_corporation_name: null,
    registration_id: null,
    head_officer_name: null,
    head_officer_business_address: null,
    last_fetched_at: new Date(0).toISOString(),
  }),
}));
vi.mock('../src/data/datasets/hpd-violations.js', () => ({
  getHpdViolations: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/data/datasets/dob-complaints.js', () => ({
  getDobComplaints: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/data/datasets/evictions.js', () => ({
  getEvictions: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/data/datasets/bedbug.js', () => ({
  getBedbugReports: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/data/datasets/lead-paint.js', () => ({
  getLeadPaintViolations: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/data/datasets/hpd-registrations.js', () => ({
  getHpdRegistrations: vi.fn().mockResolvedValue([]),
  decomposeBbl: () => ({ boroid: '1', block: '1', lot: '1' }),
}));
vi.mock('../src/data/datasets/three11-housing.js', () => ({
  get311HousingRequests: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/data/datasets/hpd-complaints.js', () => ({
  getHpdComplaints: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/ai/summary.js', () => ({
  generateSummary: mocks.generateSummaryFn,
  CostCapExceededError: class extends Error {},
}));

vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

import { createApp } from '../src/app.js';

const BBL = '1007430026';
const STALE_SUMMARY =
  'This building has 5 open HPD violations, indicating unresolved maintenance issues that the landlord has not corrected. There is 1 DOB complaint filed in the last 12 months. There are no marshal evictions on file, which is typical for stable buildings. The registered owner is not on the current Worst Landlord Watchlist. Always check the cited records yourself before relying on anything in this summary.';
const FRESH_SUMMARY =
  'The building shows recurring water-leak issues clustered in lower units.\n\nAt-risk apartments:\n- Apt. 2L: open Class B water-leak violation.\n\nAlways check the cited records yourself before relying on anything in this summary.';

beforeEach(() => {
  mocks.latestRow = null;
  mocks.insertedRows.length = 0;
  mocks.generateSummaryFn.mockReset();
  mocks.generateSummaryFn.mockResolvedValue({
    summary: FRESH_SUMMARY,
    listing_summary: null,
    score_explanation: null,
    indicators: [],
    questions_to_ask: ['Ask the broker…'],
    listing_notes: [],
    cost_cents: 1,
    ai_usage_id: 'fake',
  });
});

describe('GET /v1/building/:bbl — stale row regeneration', () => {
  it('regenerates the summary and persists a new row when the cached one lacks new-format markers', async () => {
    mocks.latestRow = {
      summary: STALE_SUMMARY,
      questions: ['Stale q?'],
      listingNotes: [],
      listingSummary: 'stale listing summary',
      scoreExplanation: 'stale score explanation',
      score: 92,
      scoreBand: 'minimal',
      scoreFactors: [{ key: 'hpd', label: 'No open HPD', impact: 0, reason: 'clean' }],
      scrapedListing: null,
      valueScore: null,
      valueBand: null,
      valueConfidence: null,
      valueFactors: null,
      valueExplanation: null,
    };

    const app = createApp();
    const res = await app.request(`/v1/building/${BBL}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    // The fresh summary text replaces the stale one.
    expect(body.summary).toBe(FRESH_SUMMARY);
    expect(mocks.generateSummaryFn).toHaveBeenCalledTimes(1);

    // The stale listing_summary/score_explanation are NOT served — they came
    // from the same generation call as the stale summary.
    expect(body.listing_summary).not.toBe('stale listing summary');
    expect(body.score_explanation).not.toBe('stale score explanation');

    // The deterministic score columns (computed in score.ts, prompt-independent)
    // ride over from `latest` so the gauge keeps rendering.
    expect(body.score).toBe(92);
    expect(body.score_band).toBe('minimal');

    // Critical: write-back happened with the fresh summary so the next page
    // view hits the cache instead of re-running the AI.
    const writeBack = mocks.insertedRows.find(
      (r) => r.buildingBbl === BBL && r.aiSummary === FRESH_SUMMARY,
    );
    expect(writeBack).toBeDefined();
    expect(writeBack?.aiSummary).toContain('At-risk apartments:');
    expect(writeBack?.aiCostCents).toBe(1);
  });

  it('serves the cached summary directly (no regen, no write-back) when the cached row is in the new format', async () => {
    mocks.latestRow = {
      summary: FRESH_SUMMARY,
      questions: ['Cached q?'],
      listingNotes: [],
      listingSummary: 'cached listing summary',
      scoreExplanation: 'cached score explanation',
      score: 92,
      scoreBand: 'minimal',
      scoreFactors: [],
      scrapedListing: null,
      valueScore: null,
      valueBand: null,
      valueConfidence: null,
      valueFactors: null,
      valueExplanation: null,
    };

    const app = createApp();
    const res = await app.request(`/v1/building/${BBL}`);
    const body = (await res.json()) as Record<string, unknown>;

    expect(body.summary).toBe(FRESH_SUMMARY);
    expect(body.listing_summary).toBe('cached listing summary');
    expect(body.score_explanation).toBe('cached score explanation');
    expect(mocks.generateSummaryFn).not.toHaveBeenCalled();
    expect(mocks.insertedRows).toHaveLength(0);
  });
});
