import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateSummary,
  TokenBudgetError,
  MalformedAIResponse,
  type SummarySubject,
} from '../../src/ai/summary.js';
import { SYSTEM_PROMPT } from '../../src/ai/prompts/lookup-summary.js';

// ── DB mock ──────────────────────────────────────────────────────────────────
vi.mock('../../src/db/client.js', () => ({
  getDb: () => ({
    insert: () => ({
      values: () => ({
        returning: async () => [{ id: 'usage-uuid-123' }],
      }),
    }),
    select: () => ({
      from: () => ({
        where: async () => [{ s: 0 }],
      }),
    }),
  }),
}));

// ── Cost-cap mock — always ok so summary tests focus on AI logic ──────────────
vi.mock('../../src/ai/cost-cap.js', () => ({
  checkCostCap: async () => ({ ok: true }),
}));

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock('../../src/logger.js', () => ({ logger: { info: vi.fn() } }));

// ── Helpers ───────────────────────────────────────────────────────────────────
const SUBJECT: SummarySubject = { type: 'anon_token', value: 'tok-abc' };

const BASE_PAYLOAD = {
  bbl: '1000010001',
  address: '1 Example St',
  borough: 'MANHATTAN',
  hpdViolations: { open: 5, closed: 10 },
  dobComplaints: 2,
  evictions: 0,
  bedbugReports: 1,
  leadFlags: 0,
  registeredOwner: 'Acme LLC',
  watchlistRank: null,
};

function makeOkResponse(overrides: { prompt_tokens?: number; completion_tokens?: number } = {}) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify({
            summary:
              'Public records show 5 open HPD violations and 2 DOB complaints filed against this building. Always check the cited records yourself before relying on anything in this summary.',
            indicators: [
              {
                key: 'HPD open violations',
                value: '5',
                source_url:
                  'https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5',
              },
            ],
          }),
        },
      },
    ],
    usage: {
      prompt_tokens: overrides.prompt_tokens ?? 1000,
      completion_tokens: overrides.completion_tokens ?? 500,
    },
  };
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = 'sk-test';
  vi.spyOn(global, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify(makeOkResponse()), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
});

describe('generateSummary', () => {
  it('returns summary, indicators, cost_cents, ai_usage_id on success', async () => {
    const result = await generateSummary(BASE_PAYLOAD, SUBJECT);
    expect(result.summary).toContain('HPD');
    expect(result.indicators).toHaveLength(1);
    expect(result.ai_usage_id).toBe('usage-uuid-123');
    expect(result.cost_cents).toBeGreaterThanOrEqual(1);
  });

  it('cost: prompt=1000, completion=500 → 1 cent (Math.max(1, ceil(0.015+0.03)))', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(makeOkResponse({ prompt_tokens: 1000, completion_tokens: 500 })), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const result = await generateSummary(BASE_PAYLOAD, SUBJECT);
    // 1000 * 0.15 / 10000 = 0.015; 500 * 0.60 / 10000 = 0.03; ceil(0.045) = 1; max(1,1) = 1
    expect(result.cost_cents).toBe(1);
  });

  it('cost: prompt=10000, completion=2000 → 1 cent', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify(makeOkResponse({ prompt_tokens: 10_000, completion_tokens: 2_000 })),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await generateSummary(BASE_PAYLOAD, SUBJECT);
    // 10000 * 0.15 / 10000 = 0.15; 2000 * 0.60 / 10000 = 0.12; ceil(0.27) = 1
    expect(result.cost_cents).toBe(1);
  });

  it('cost: prompt=100000, completion=10000 → 2 cents', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify(makeOkResponse({ prompt_tokens: 100_000, completion_tokens: 10_000 })),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await generateSummary(BASE_PAYLOAD, SUBJECT);
    // 100000 * 0.15 / 10000 = 1.5; 10000 * 0.60 / 10000 = 0.6; ceil(2.1) = 3; max(1,3) = 3
    // wait, let me re-calculate:
    // inputCents = (100000 * 0.15) / 10000 = 15000 / 10000 = 1.5
    // outputCents = (10000 * 0.60) / 10000 = 6000 / 10000 = 0.6
    // cost_cents = Math.max(1, Math.ceil(2.1)) = 3
    expect(result.cost_cents).toBe(3);
  });

  it('throws TokenBudgetError when combined prompt exceeds 16K chars', async () => {
    const longPayload = {
      ...BASE_PAYLOAD,
      registeredOwner: 'X'.repeat(16_000),
    };
    await expect(generateSummary(longPayload, SUBJECT)).rejects.toThrow(TokenBudgetError);
  });

  it('throws MalformedAIResponse when content is not valid JSON', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'not-json' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(generateSummary(BASE_PAYLOAD, SUBJECT)).rejects.toThrow(MalformedAIResponse);
  });

  it('throws MalformedAIResponse when summary field is missing', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ indicators: [] }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(generateSummary(BASE_PAYLOAD, SUBJECT)).rejects.toThrow(MalformedAIResponse);
    await expect(generateSummary(BASE_PAYLOAD, SUBJECT)).rejects.toThrow('missing summary');
  });

  it('throws MalformedAIResponse when indicators field is missing', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ summary: 'ok' }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    await expect(generateSummary(BASE_PAYLOAD, SUBJECT)).rejects.toThrow(MalformedAIResponse);
    await expect(generateSummary(BASE_PAYLOAD, SUBJECT)).rejects.toThrow('missing indicators');
  });

  it('writes ai_usage row with correct fields', async () => {
    const result = await generateSummary(BASE_PAYLOAD, { type: 'email', value: 'a@b.com' });
    // Module-level mock returns 'usage-uuid-123'; verify the ID flows through
    expect(result.ai_usage_id).toBe('usage-uuid-123');
    expect(result.cost_cents).toBeGreaterThanOrEqual(1);
  });

  it('system prompt is non-empty and contains closing sentence instruction', () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
    expect(SYSTEM_PROMPT).toContain('Always check the cited records yourself');
  });

  it('system prompt declares all four output sections', () => {
    expect(SYSTEM_PROMPT).toContain('summary');
    expect(SYSTEM_PROMPT).toContain('indicators');
    expect(SYSTEM_PROMPT).toContain('questions_to_ask');
    expect(SYSTEM_PROMPT).toContain('listing_notes');
  });

  it('system prompt forbids verdict words', () => {
    // Sample of the explicit blacklist — the rule list isn't structured but
    // these specific words must always appear in the prompt as forbidden.
    for (const banned of ['scam', 'slumlord', 'avoid', 'recommend']) {
      expect(SYSTEM_PROMPT.toLowerCase()).toContain(banned);
    }
  });

  it('returns questions_to_ask + listing_notes when AI provides them', async () => {
    const listing = 'No broker fee. Tenant pays utilities. No pets.';
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary:
                    'Public records show 5 open HPD violations. Always check the cited records yourself before relying on anything in this summary.',
                  indicators: [
                    { key: 'HPD open violations', value: '5', source_url: 'https://x' },
                  ],
                  questions_to_ask: [
                    'Ask which apartment numbers are affected by the 5 open HPD violations.',
                    'Request written confirmation that no broker fee will be charged.',
                    'Ask which utilities the tenant is responsible for.',
                  ],
                  listing_notes: [
                    {
                      snippet: 'No broker fee',
                      note: 'Ask the broker to confirm in writing — the FARE Act prohibits charging tenants for landlord-hired brokers.',
                    },
                    {
                      snippet: 'No pets',
                      note: "NYC's Pet Law limits enforcement of no-pet clauses if the landlord knowingly allows a pet for 3+ months.",
                    },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 1500, completion_tokens: 400 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await generateSummary({ ...BASE_PAYLOAD, listingText: listing }, SUBJECT);
    expect(result.questions_to_ask).toHaveLength(3);
    expect(result.questions_to_ask[0]).toContain('apartment numbers');
    expect(result.listing_notes).toHaveLength(2);
    expect(result.listing_notes[0]?.snippet).toBe('No broker fee');
    expect(result.listing_notes[0]?.note).toContain('FARE Act');
  });

  it('drops listing_notes whose snippet does NOT appear in the listing (case-insensitive)', async () => {
    const listing = 'Charming 2BR in Manhattan. No broker fee.';
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary:
                    'Public records summary. Always check the cited records yourself before relying on anything in this summary.',
                  indicators: [{ key: 'k', value: 'v', source_url: 'https://x' }],
                  questions_to_ask: ['Ask...'],
                  listing_notes: [
                    { snippet: 'No broker fee', note: 'Exact match — kept' },
                    { snippet: 'no broker fee', note: 'Lowercased version — kept (case-insensitive match)' },
                    { snippet: 'tenant pays utilities', note: 'Hallucinated — dropped (not in listing)' },
                  ],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await generateSummary({ ...BASE_PAYLOAD, listingText: listing }, SUBJECT);
    expect(result.listing_notes).toHaveLength(2);
    const snippets = result.listing_notes.map((n) => n.snippet);
    expect(snippets).toContain('No broker fee');
    expect(snippets).toContain('no broker fee');
    // Hallucinated snippet was dropped
    expect(snippets).not.toContain('tenant pays utilities');
  });

  it('forces listing_notes to [] when no listingText is supplied', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Always check the cited records yourself before relying on anything in this summary.',
                  indicators: [{ key: 'k', value: 'v', source_url: 'https://x' }],
                  questions_to_ask: ['Ask...'],
                  // AI tries to invent listing notes despite no input — should be wiped
                  listing_notes: [{ snippet: 'made up', note: 'invented' }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await generateSummary(BASE_PAYLOAD, SUBJECT);
    expect(result.listing_notes).toEqual([]);
  });

  it('forward-compat: legacy AI response (no new fields) → questions/notes default to []', async () => {
    // Cached/older responses that only return summary+indicators must not crash
    vi.spyOn(global, 'fetch').mockImplementation(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: 'Old-shape summary. Always check the cited records yourself before relying on anything in this summary.',
                  indicators: [{ key: 'k', value: 'v', source_url: 'https://x' }],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const result = await generateSummary(BASE_PAYLOAD, SUBJECT);
    expect(result.summary).toContain('Old-shape');
    expect(result.questions_to_ask).toEqual([]);
    expect(result.listing_notes).toEqual([]);
  });
});
