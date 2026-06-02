// Phase 6: streaming variant of /v1/lookup.
// Validates the NDJSON wrapper around the runLookup pipeline:
//   - Content-Type is application/x-ndjson
//   - Phase events are emitted in the expected order
//   - The final 'complete' line carries the response body
//
// We mock all external dependencies so the tests don't need a DB,
// Socrata access, or OpenAI access.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// All inserts/upserts return empty (we never read the result in the pipeline
// except for `building_lookups.returning({ id })` which returns [] → row?.id
// becomes undefined → response.lookup_id = null. Fine for our assertions.)
vi.mock('../src/db/client.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
        onConflictDoUpdate: async () => undefined,
        returning: async () => [{ id: 'fake-lookup-id' }],
      }),
    }),
    // Phase 8: findRecentLookup queries building_lookups for a recent row.
    // The streaming tests want CACHE-MISS behavior (full pipeline runs), so
    // the chained select returns []. The dedicated lookup-cache.test.ts file
    // overrides this mock to return a populated row when testing the hit path.
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: async () => [],
          }),
          // Single-row variant used by the BBL-bypass branch and getCachedBatch
          // when called via Drizzle. The dataset wrappers themselves are mocked
          // separately, so this just needs to satisfy any incidental reads.
          limit: async () => [],
        }),
      }),
    }),
  }),
  // getCachedBatch (src/data/cache.ts) hits the raw pool. The dataset wrappers
  // are mocked individually so cache.ts is bypassed for them, but lookup.ts
  // still calls getCachedBatch directly. Returning rows=[] = cache miss.
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
vi.mock('../src/data/datasets/hpd-complaints.js', () => ({
  getHpdComplaints: vi.fn().mockResolvedValue([]),
}));
vi.mock('../src/data/datasets/three11-housing.js', () => ({
  get311HousingRequests: vi.fn().mockResolvedValue([]),
}));

vi.mock('../src/ai/summary.js', () => ({
  generateSummary: vi.fn().mockResolvedValue({
    summary: 'A neutral summary.',
    listing_summary: null,
    score_explanation: null,
    indicators: [],
    questions_to_ask: [],
    listing_notes: [],
    cost_cents: 0,
  }),
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

// Logger spam suppression
vi.mock('../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  },
}));

// Imports come after mocks so the mocks are wired before the SUT pulls them in.
import { createApp } from '../src/app.js';
import { geosearch } from '../src/geo/geosearch.js';
import { scrapeListing } from '../src/scraping/fetcher.js';

// Default geosearch behavior — happy path, in-NYC.
const HAPPY_BBL = '1008240001';
beforeEach(() => {
  vi.mocked(geosearch).mockReset();
  vi.mocked(geosearch).mockResolvedValue({
    kind: 'matched',
    bbl: HAPPY_BBL,
    address: '350 5th Ave',
    borough: 'MANHATTAN',
    confidence: 1,
  } as Awaited<ReturnType<typeof geosearch>>);
  vi.mocked(scrapeListing).mockReset();
});

// ── Helper: collect all NDJSON lines from a streaming Response ────────────────
async function readNdjson(res: Response): Promise<Array<Record<string, unknown>>> {
  expect(res.body).toBeTruthy();
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const lines: Array<Record<string, unknown>> = [];
  // Drain the stream completely.
  // The `done` flag fires when the server closes the response.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) lines.push(JSON.parse(line));
    }
    if (done) break;
  }
  return lines;
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('POST /v1/lookup/stream', () => {
  it('returns NDJSON content-type', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '350 5th Ave' }),
    });
    expect(res.headers.get('Content-Type')).toContain('application/x-ndjson');
    expect(res.headers.get('X-Accel-Buffering')).toBe('no');
    // Drain so the stream closes cleanly.
    await readNdjson(res);
  });

  it('emits parse → geo → hpd/dob/owner → ai → complete on the happy path', async () => {
    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '350 5th Ave' }),
    });
    const lines = await readNdjson(res);

    // Filter to phase events vs the single complete event
    const phaseEvents = lines
      .filter((l) => l.event === 'phase')
      .map((l) => l.name);
    const completes = lines.filter((l) => l.event === 'complete');

    // parse comes first (immediate for address-only)
    expect(phaseEvents[0]).toBe('parse');
    // geo comes after parse
    expect(phaseEvents[1]).toBe('geo');
    // hpd and owner run in parallel and can interleave at positions 2-3.
    // dob is sequenced after them because it needs the BIN from HPD
    // registrations (DOB Open Data is keyed by BIN, not BBL).
    const parallelPhases = new Set(phaseEvents.slice(2, 4));
    expect(parallelPhases).toEqual(new Set(['hpd', 'owner']));
    expect(phaseEvents[4]).toBe('dob');
    // ai is last
    expect(phaseEvents[5]).toBe('ai');
    // exactly one complete line
    expect(completes).toHaveLength(1);
    const complete = completes[0] as { status: number; response: { kind: string } };
    expect(complete.status).toBe(200);
    expect(complete.response.kind).toBe('success');
  });

  it('emits parse + complete (no geo) when geosearch returns outside_nyc', async () => {
    vi.mocked(geosearch).mockResolvedValue({
      kind: 'outside_nyc',
      detected_city: 'Boston',
      detected_state: 'MA',
    } as Awaited<ReturnType<typeof geosearch>>);

    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '123 Main St, Boston' }),
    });
    const lines = await readNdjson(res);

    const phases = lines.filter((l) => l.event === 'phase').map((l) => l.name);
    // parse fires for any non-URL request; geo does NOT fire on outside_nyc
    expect(phases).toEqual(['parse']);

    const completes = lines.filter((l) => l.event === 'complete');
    expect(completes).toHaveLength(1);
    const complete = completes[0] as { response: { kind: string; detected_city: string } };
    expect(complete.response.kind).toBe('outside_nyc');
    expect(complete.response.detected_city).toBe('Boston');
  });

  it('returns ambiguous (no geo) when geosearch is a tie and no bbl is forwarded', async () => {
    vi.mocked(geosearch).mockResolvedValue({
      kind: 'ambiguous',
      matches: [
        { bbl: '4097110030', address: '140-02 84 Drive, Briarwood', borough: 'QUEENS' },
        { bbl: '4097110032', address: '140-10 84 Drive, Briarwood', borough: 'QUEENS' },
      ],
    } as Awaited<ReturnType<typeof geosearch>>);

    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '84 Drive, Briarwood' }),
    });
    const lines = await readNdjson(res);

    // geo does NOT fire on an unresolved ambiguous result
    const phases = lines.filter((l) => l.event === 'phase').map((l) => l.name);
    expect(phases).toEqual(['parse']);

    const completes = lines.filter((l) => l.event === 'complete');
    expect(completes).toHaveLength(1);
    const complete = completes[0] as { response: { kind: string; matches: unknown[] } };
    expect(complete.response.kind).toBe('ambiguous');
    expect(complete.response.matches).toHaveLength(2);
  });

  it('resolves to success (no loop) when a forwarded bbl matches an ambiguous candidate', async () => {
    // Regression: the disambiguation picker forwards { address, bbl }. The
    // backend must select that candidate instead of re-returning the same
    // ambiguous list — otherwise the UI bounces back to "Pick the right
    // address" forever (hyphenated Queens addresses never disambiguate by
    // label alone).
    vi.mocked(geosearch).mockResolvedValue({
      kind: 'ambiguous',
      matches: [
        { bbl: '4097110030', address: '140-02 84 Drive, Briarwood', borough: 'QUEENS' },
        { bbl: '4097110032', address: '140-10 84 Drive, Briarwood', borough: 'QUEENS' },
      ],
    } as Awaited<ReturnType<typeof geosearch>>);

    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: '140-10 84 Drive, Briarwood', bbl: '4097110032' }),
    });
    const lines = await readNdjson(res);

    // geo fires now that the bbl resolved the tie, and the full pipeline runs.
    const phases = lines.filter((l) => l.event === 'phase').map((l) => l.name);
    expect(phases).toContain('geo');

    const completes = lines.filter((l) => l.event === 'complete');
    expect(completes).toHaveLength(1);
    const complete = completes[0] as { response: { kind: string; bbl: string } };
    expect(complete.response.kind).toBe('success');
    expect(complete.response.bbl).toBe('4097110032');
  });

  it('emits only complete (no phases) when scrape returns listing_blocked', async () => {
    vi.mocked(scrapeListing).mockResolvedValue({
      kind: 'error',
      code: 'listing_blocked',
      message: 'Bot protection blocked the fetch',
    } as Awaited<ReturnType<typeof scrapeListing>>);

    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingUrl: 'https://streeteasy.com/building/blocked' }),
    });
    const lines = await readNdjson(res);

    const phases = lines.filter((l) => l.event === 'phase');
    // No phase events: scrape failed before we could emit parse.
    expect(phases).toEqual([]);

    const completes = lines.filter((l) => l.event === 'complete');
    expect(completes).toHaveLength(1);
    const complete = completes[0] as { response: { kind: string } };
    expect(complete.response.kind).toBe('listing_blocked');
  });

  it('returns the standardized validation_failed envelope for empty body (no stream opened)', async () => {
    // Phase 11.2: pre-handler validation throws AppError before the stream
    // context is entered, so the response is a plain JSON envelope rather
    // than an NDJSON complete event. The frontend's withRetry/error path
    // treats this as a regular 400 to surface to the user.
    const app = createApp();
    const res = await app.request('/v1/lookup/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string; requestId?: string } };
    expect(body.error?.code).toBe('validation_failed');
    expect(typeof body.error?.requestId).toBe('string');
  });
});
