// Building lookup AI summary generator.
// Calls gpt-4o-mini, validates output, logs cost to ai_usage.
// Does NOT make legal determinations — describes public records only.
//
// Note: ai_usage has no anon_token column (schema §1.5 design).
// For anon lookups both user_id and email are null; cost tracking for
// anon subjects uses building_lookups.ai_cost_cents via checkCostCap().

import { callChat } from './openai-client.js';
import { SYSTEM_PROMPT, buildUserPrompt, type BuildingPayload } from './prompts/lookup-summary.js';
import { checkCostCap } from './cost-cap.js';
import { getDb } from '../db/client.js';
import { aiUsage } from '../db/schema.js';
import { logger } from '../logger.js';

const MAX_INPUT_CHARS = 16_000; // ~4K tokens; well within gpt-4o-mini context
const PRICE_INPUT_PER_M = 0.15; // $ per million input tokens
const PRICE_OUTPUT_PER_M = 0.6; // $ per million output tokens

export class TokenBudgetError extends Error {
  constructor() {
    super('input exceeds 4K token budget');
    this.name = 'TokenBudgetError';
  }
}

export class MalformedAIResponse extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'MalformedAIResponse';
  }
}

export class CostCapExceededError extends Error {
  constructor(
    public readonly cap_cents: number,
    public readonly spent_cents: number,
  ) {
    super(`cost cap exceeded: ${spent_cents}¢ spent, ${cap_cents}¢ cap`);
    this.name = 'CostCapExceededError';
  }
}

export type SummaryIndicator = { key: string; value: string; source_url: string };
export type SummaryQuestion = string;
export type SummaryListingNote = { snippet: string; note: string };

export type SummaryResult = {
  summary: string;
  indicators: SummaryIndicator[];
  /** Specific factual questions the renter should ask. Always non-empty (3–5). */
  questions_to_ask: SummaryQuestion[];
  /** Neutral observations about listing copy. Empty when no listing was supplied. */
  listing_notes: SummaryListingNote[];
  cost_cents: number;
  ai_usage_id: string;
};

export type SummarySubject =
  | { type: 'user_id'; value: string }
  | { type: 'email'; value: string }
  | { type: 'anon_token'; value: string };

export async function generateSummary(
  payload: BuildingPayload,
  subject: SummarySubject,
): Promise<SummaryResult> {
  // Phase 3.7b: enforce 24h rolling cost cap before incurring any API cost
  const cap = await checkCostCap({ type: subject.type, value: subject.value });
  if (!cap.ok) throw new CostCapExceededError(cap.cap_cents, cap.spent_cents);

  const userPrompt = buildUserPrompt(payload);
  if (SYSTEM_PROMPT.length + userPrompt.length > MAX_INPUT_CHARS) throw new TokenBudgetError();

  const res = await callChat({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    // 1500 leaves headroom for: ≤120-word summary + 6 indicators + 5 questions
    // + 5 listing_notes (each ~50 tokens for snippet+note). Was 1000 when we
    // only asked for summary+indicators.
    max_completion_tokens: 1500,
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const raw = res.choices[0]?.message.content;
  if (!raw) throw new MalformedAIResponse('empty content');

  let parsed: {
    summary?: string;
    indicators?: unknown[];
    questions_to_ask?: unknown[];
    listing_notes?: unknown[];
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new MalformedAIResponse('not json');
  }
  if (typeof parsed.summary !== 'string') throw new MalformedAIResponse('missing summary');
  if (!Array.isArray(parsed.indicators)) throw new MalformedAIResponse('missing indicators');

  // Forward-compatible: accept legacy responses that omit the new sections.
  // The model SHOULD return both, but tolerate missing fields by defaulting
  // to empty arrays rather than throwing — older cached prompts or model
  // glitches shouldn't break the whole lookup.
  const questions_to_ask: SummaryQuestion[] = Array.isArray(parsed.questions_to_ask)
    ? parsed.questions_to_ask.filter((q): q is string => typeof q === 'string' && q.length > 0)
    : [];

  const listing_notes: SummaryListingNote[] = Array.isArray(parsed.listing_notes)
    ? parsed.listing_notes.filter(
        (n): n is SummaryListingNote =>
          !!n &&
          typeof n === 'object' &&
          typeof (n as { snippet?: unknown }).snippet === 'string' &&
          typeof (n as { note?: unknown }).note === 'string',
      )
    : [];

  // If a listingText was supplied, drop notes whose snippet doesn't appear
  // in it (case-insensitive) — the prompt forbids invented quotes, but we
  // enforce belt-and-suspenders. Case-insensitive because gpt-4o-mini
  // normalizes capitalization in quoted snippets ("No broker fee" → "no broker fee").
  const verifiedListingNotes = payload.listingText
    ? (() => {
        const haystack = payload.listingText!.toLowerCase();
        return listing_notes.filter((n) => haystack.includes(n.snippet.toLowerCase()));
      })()
    : [];

  // Pricing: convert token counts to cents
  const inputCents = (res.usage.prompt_tokens * PRICE_INPUT_PER_M) / 10_000;
  const outputCents = (res.usage.completion_tokens * PRICE_OUTPUT_PER_M) / 10_000;
  const cost_cents = Math.max(1, Math.ceil(inputCents + outputCents));

  const usageRows = await getDb()
    .insert(aiUsage)
    .values({
      userId: subject.type === 'user_id' ? subject.value : null,
      email: subject.type === 'email' ? subject.value : null,
      route: 'lookup',
      costCents: cost_cents,
      modelUsed: 'gpt-4o-mini',
    })
    .returning({ id: aiUsage.id });
  const usageId = usageRows[0]?.id ?? 'unknown';

  logger.info({ cost_cents, ai_usage_id: usageId, subject_type: subject.type });

  return {
    summary: parsed.summary,
    indicators: parsed.indicators as SummaryIndicator[],
    questions_to_ask,
    listing_notes: verifiedListingNotes,
    cost_cents,
    ai_usage_id: usageId,
  };
}
