// Phase 8: cache-hit short-circuit on repeat lookups.
// Verifies that an address-only POST to /v1/lookup/stream skips the OpenAI
// call when a recent building_lookups row already exists for the BBL.
//
// Pattern mirrors lookup-stream.test.ts — mock all external deps so the
// pipeline runs in-process. The DB mock here is configurable per test:
// `mocks.cachedRow` controls what `findRecentLookup`'s SELECT returns,
// and `mocks.insertedRows` captures every INSERT for assertion.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mock state ─────────────────────────────────────────────────────
// vi.hoisted runs before vi.mock, so the factory closures below capture
// these references. Mutating `mocks.*` from inside a test changes what
// the next request sees.
const { mocks } = vi.hoisted(() => ({
  mocks: {
    cachedRow: null as Record<string, unknown> | null,
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
          returning: async () => [{ id: 'fake-lookup-id' }],
        };
      },
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => (mocks.cachedRow ? [mocks.cachedRow] : []),
          }),
          // Single-row variant for the BBL-bypass branch — not exercised in
          // these tests but provided so the chain doesn't blow up if reached.
          limit: async () => [],
        }),
      }),
    }),
  }),
  // getCachedBatch hits the raw pool. Dataset wrappers are mocked separately,
  // so this just needs to satisfy lookup.ts's call. rows=[] = cache miss.
  getPool: () => ({
    query: async () => ({ rows: [] }),
  }),
}));

vi.mock('../src/lib/counters.js', () => ({
  LIMITS: { FREE_ANON_LIMIT: 1000, FREE_EMAIL_LIMIT_30D: 1000 },
  countAnonLookups: async () => 0,
  countEmailLookups: async () => 0,
  incrementEmailCounter: async () => undefined,
}));

vi.mock('../src/geo/geosearch.js', () => ({
  geosearch: vi.fn(),
}));

vi.mock('../src/scraping/fetcher.js', () => ({
  scrapeListing: vi.fn(),
}));

vi.mock('../src/data/landlord.js', () => ({
  lookupLandlord: vi.fn().mockResolvedValue({
    registered_owner_name: 'Test Owner LLC',
    watchlist_rank: null,
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

vi.mock('../src/ai/summary.js', () => ({
  generateSummary: mocks.generateSummaryFn,
  CostCapExceededError: class extends Error {},
}));

vi.mock('../src/scoring/score.js', () => ({
  computeScore: () => ({
    score: 95,
    band: 'minimal',
    factors: [],
  }),
}));

vi.mock('../src/fare/check.js', () => ({
  checkFare: () => null,
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

// Imports after the mocks so the SUT picks them up.
import { createApp } from '../src/app.js';
import { geosearch } from '../src/geo/geosearch.js';
import { scrapeListing } from '../src/scraping/fetcher.js';

const HAPPY_BBL = '1008240001';

beforeEach(() => {
  mocks.cachedRow = null;
  mocks.insertedRows.length = 0;
  mocks.generateSummaryFn.mockReset();
  // Default: AI returns a usable summary so cache-miss tests pass through.
  mocks.generateSummaryFn.mockResolvedValue({
    summary: 'Fresh AI summary.',
    listing_summary: null,
    score_explanation: null,
    indicators: [],
    questions_to_ask: [],
    listing_notes: [],
    cost_cents: 100,
  });
  vi.mocked(geosearch).mockReset();
  vi.mocked(geosearch).mockResolvedValue({
    kind: 'matched',
    bbl: HAPPY_BBL,
    address: '350 5 AVENUE, New York, NY, USA',
    borough: 'MANHATTAN',
    confidence: 1,
  } as Awaited<ReturnType<typeof geosearch>>);
  vi.mocked(scrapeListing).mockReset();
});

async function readNdjson(res: Response): Promise<Array<Record<string, unknown>>> {
  expect(res.body).toBeTruthy();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const lines: Array<Record<string, unknown>> = [];
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) lines.push(JSON.parse(line) as Record<string, unknown>);
    }
    if (done) break;
  }
  return lines;
}

function makeCachedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // Includes the "At-risk apartments:" marker so it would also pass the
    // SQL LIKE filter in findRecentLookup (the mock bypasses SQL filtering,
    // but matching prod behavior in the fixture keeps the test honest).
    summary:
      'Cached AI summary.\n\nAt-risk apartments:\n- No specific units recurred across recent records.',
    questions: ['Cached q?'],
    listingNotes: [],
    listingSummary: null,
    scoreExplanation: 'Cached score explanation.',
    score: 92,
    scoreBand: 'minimal',
    scoreFactors: [{ key: 'hpd', label: 'No open HPD', impact: 0, reason: 'clean' }],
    ...overrides,
  };
}

describe('POST /v1/lookup/stream — cache miss', () => {
  it('runs the full pipeline and calls generateSummary when no recent row exists', async () => {
    mocks.cachedRow = null;

    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '350 5th Ave' }),
    });
    const lines = await readNdjson(res);

    expect(mocks.generateSummaryFn).toHaveBeenCalledTimes(1);

    const complete = lines.find((l) => l.event === 'complete') as
      | { status: number; response: { kind: string; summary: string } }
      | undefined;
    expect(complete?.response.kind).toBe('success');
    // Fresh AI text comes through, not the cache.
    expect(complete?.response.summary).toBe('Fresh AI summary.');

    // The single building_lookups insert (the upsert into `buildings` is a
    // separate insert that we filter out here) records the AI cost.
    const lookupInserts = mocks.insertedRows.filter(
      (r) => r.buildingBbl === HAPPY_BBL && 'aiSummary' in r,
    );
    expect(lookupInserts).toHaveLength(1);
    expect(lookupInserts[0]?.aiCostCents).toBe(100);
  });
});

describe('POST /v1/lookup/stream — cache hit (address-only)', () => {
  it('skips generateSummary and reuses the cached AI fields', async () => {
    mocks.cachedRow = makeCachedRow();
    // Make the AI throw if called — cache hit MUST avoid invoking it.
    mocks.generateSummaryFn.mockImplementation(() => {
      throw new Error('generateSummary should not be called on a cache hit');
    });

    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '350 5th Ave' }),
    });
    const lines = await readNdjson(res);

    expect(mocks.generateSummaryFn).not.toHaveBeenCalled();

    const complete = lines.find((l) => l.event === 'complete') as
      | { status: number; response: Record<string, unknown> }
      | undefined;
    expect(complete?.response.kind).toBe('success');
    expect(complete?.response.summary).toContain('Cached AI summary.');
    expect(complete?.response.summary).toContain('At-risk apartments:');
    expect(complete?.response.score).toBe(92);
    expect(complete?.response.score_band).toBe('minimal');
    expect(complete?.response.score_explanation).toBe('Cached score explanation.');
    expect(complete?.response.questions_to_ask).toEqual(['Cached q?']);

    // Cache-hit insert exists, with the marker aiCostCents === 0.
    const lookupInserts = mocks.insertedRows.filter(
      (r) => r.buildingBbl === HAPPY_BBL && 'aiSummary' in r,
    );
    expect(lookupInserts).toHaveLength(1);
    expect(lookupInserts[0]?.aiCostCents).toBe(0);
    expect(lookupInserts[0]?.aiSummary).toContain('Cached AI summary.');
    // Address-only requests must persist a null scraped_listing so this row
    // remains eligible for future cache hits.
    expect(lookupInserts[0]?.aiScrapedListing).toBeNull();
  });
});

describe('POST /v1/lookup/stream — URL input bypasses the cache', () => {
  it('runs the full pipeline even when a cached row exists', async () => {
    mocks.cachedRow = makeCachedRow();
    vi.mocked(scrapeListing).mockResolvedValue({
      kind: 'ok',
      fetchMethod: 'direct',
      data: {
        url: 'https://streeteasy.com/building/example',
        source: 'streeteasy',
        source_kind: 'rental',
        fetchedAt: new Date().toISOString(),
        address: '350 5 AVENUE, New York, NY, USA',
        unit: null,
        monthlyRentCents: null,
        bedrooms: null,
        bathrooms: null,
        squareFeet: null,
        brokerFeeStated: 'unknown',
        brokerFeeText: null,
        securityDepositText: null,
        leaseTermMonths: null,
        petsPolicy: null,
        utilitiesIncluded: [],
        amenities: [],
        availabilityDate: null,
        description: 'Listing description text.',
        title: null,
        daysOnMarket: null,
        agentName: null,
        brokerage: null,
        confidence: 'high',
      },
    } as Awaited<ReturnType<typeof scrapeListing>>);

    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingUrl: 'https://streeteasy.com/building/example' }),
    });
    await readNdjson(res);

    // URL input has listing context (FARE flag, scrape data) that the cached
    // AI doesn't reflect — we MUST regenerate the summary.
    expect(mocks.generateSummaryFn).toHaveBeenCalledTimes(1);
  });
});
