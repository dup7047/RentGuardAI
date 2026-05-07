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

export type SummaryResult = {
  summary: string;
  indicators: Array<{ key: string; value: string; source_url: string }>;
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
    max_completion_tokens: 1000,
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const raw = res.choices[0]?.message.content;
  if (!raw) throw new MalformedAIResponse('empty content');

  let parsed: { summary?: string; indicators?: unknown[] };
  try {
    parsed = JSON.parse(raw) as { summary?: string; indicators?: unknown[] };
  } catch {
    throw new MalformedAIResponse('not json');
  }
  if (typeof parsed.summary !== 'string') throw new MalformedAIResponse('missing summary');
  if (!Array.isArray(parsed.indicators)) throw new MalformedAIResponse('missing indicators');

  // Pricing: convert token counts to cents
  const inputCents = (res.usage.prompt_tokens * PRICE_INPUT_PER_M) / 10_000;
  const outputCents = (res.usage.completion_tokens * PRICE_OUTPUT_PER_M) / 10_000;
  const cost_cents = Math.max(1, Math.ceil(inputCents + outputCents));

  const [usage] = await getDb()
    .insert(aiUsage)
    .values({
      userId: subject.type === 'user_id' ? subject.value : null,
      email: subject.type === 'email' ? subject.value : null,
      route: 'lookup',
      costCents: cost_cents,
      modelUsed: 'gpt-4o-mini',
    })
    .returning({ id: aiUsage.id });

  logger.info({ cost_cents, ai_usage_id: usage.id, subject_type: subject.type });

  return {
    summary: parsed.summary,
    indicators: parsed.indicators as Array<{ key: string; value: string; source_url: string }>,
    cost_cents,
    ai_usage_id: usage.id,
  };
}
