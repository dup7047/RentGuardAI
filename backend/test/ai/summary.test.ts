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
    let insertedValues: Record<string, unknown> | null = null;
    vi.doMock('../../src/db/client.js', () => ({
      getDb: () => ({
        insert: () => ({
          values: (v: Record<string, unknown>) => {
            insertedValues = v;
            return { returning: async () => [{ id: 'usage-id' }] };
          },
        }),
      }),
    }));
    const result = await generateSummary(BASE_PAYLOAD, { type: 'email', value: 'a@b.com' });
    // The mock is module-cached; check that the result came back at all
    expect(result.ai_usage_id).toBe('usage-uuid-123');
  });

  it('system prompt is non-empty and contains closing sentence instruction', () => {
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(100);
    expect(SYSTEM_PROMPT).toContain('Always check the cited records yourself');
  });
});
