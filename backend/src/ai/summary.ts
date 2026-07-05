// Building lookup AI summary generator: calls gpt-4o-mini, validates
// output, logs cost to ai_usage. Describes public records only — never
// legal determinations. Anon cost tracking rides on
// building_lookups.ai_cost_cents because ai_usage has no anon_token column.

import { callChat } from './openai-client.js';
import { SYSTEM_PROMPT, buildUserPrompt, type BuildingPayload } from './prompts/lookup-summary.js';
import { checkCostCap } from './cost-cap.js';
import { getDb } from '../db/client.js';
import { aiUsage } from '../db/schema.js';
import { logger } from '../logger.js';

const MAX_INPUT_CHARS = 24_000; // ~6K tokens; sized for record-level HPD/DOB/311 context
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
  /** 2-3 sentence listing narrative. Empty for address-only lookups. */
  listing_summary: string;
  /** ≤220-word risk briefing with literal newlines and "- " bullets; render with white-space: pre-line. */
  summary: string;
  /** AI-narrated explanation of the deterministic score. */
  score_explanation: string;
  /** Value score explanation narrating the comp data. Empty when no value score was computed. */
  value_explanation: string;
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
  // Enforce the 24h rolling cost cap before incurring any API cost.
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
    // 1800 leaves headroom for the 7 sections: ≤220-word pattern-lede +
    // at-risk-apartments summary + score_explanation + value_explanation +
    // 6 indicators + 5 questions + 5 listing_notes.
    max_completion_tokens: 1800,
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const raw = res.choices[0]?.message.content;
  if (!raw) throw new MalformedAIResponse('empty content');

  let parsed: {
    listing_summary?: string;
    summary?: string;
    score_explanation?: string;
    value_explanation?: string;
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

  // Indicators are model output that the frontend renders as links — enforce
  // the shape and require http(s) source_url instead of trusting a cast, so a
  // malformed entry (or a javascript:/data: URL) never reaches the client.
  const indicators: SummaryIndicator[] = parsed.indicators.filter(
    (i): i is SummaryIndicator => {
      if (!i || typeof i !== 'object') return false;
      const o = i as Record<string, unknown>;
      return (
        typeof o.key === 'string' &&
        typeof o.value === 'string' &&
        typeof o.source_url === 'string' &&
        /^https?:\/\//i.test(o.source_url)
      );
    },
  );

  // Tolerate legacy responses that omit newer sections.
  const listing_summary =
    typeof parsed.listing_summary === 'string' ? parsed.listing_summary : '';
  const score_explanation =
    typeof parsed.score_explanation === 'string' ? parsed.score_explanation : '';
  const value_explanation =
    typeof parsed.value_explanation === 'string' ? parsed.value_explanation : '';

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

  // Drop notes whose snippet doesn't appear in the listing text — the prompt
  // forbids invented quotes but we enforce it anyway. Case-insensitive
  // because the model normalizes capitalization in quoted snippets.
  const verifiedListingNotes = payload.listingText
    ? (() => {
        const haystack = payload.listingText!.toLowerCase();
        return listing_notes.filter((n) => haystack.includes(n.snippet.toLowerCase()));
      })()
    : [];

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
    listing_summary,
    summary: parsed.summary,
    score_explanation,
    value_explanation,
    indicators,
    questions_to_ask,
    listing_notes: verifiedListingNotes,
    cost_cents,
    ai_usage_id: usageId,
  };
}
