// 24-hour rolling cost caps by subject type.
// Called by generateSummary() before each AI call.
// anon_token caps read from building_lookups.ai_cost_cents because
// ai_usage has no anon_token column by design.

import { getDb } from '../db/client.js';
import { aiUsage, buildingLookups } from '../db/schema.js';
import { sql, and, gte, eq } from 'drizzle-orm';

export const COST_CAPS_24H_CENTS = {
  anon_token: 20, // $0.20
  email: 50, // $0.50
  user_id: 500, // $5.00
} as const;

export type CapSubject =
  | { type: 'user_id'; value: string }
  | { type: 'email'; value: string }
  | { type: 'anon_token'; value: string };

export type CapCheck = { ok: true } | { ok: false; cap_cents: number; spent_cents: number };

export async function checkCostCap(subject: CapSubject): Promise<CapCheck> {
  const cap = COST_CAPS_24H_CENTS[subject.type];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let spent = 0;

  if (subject.type === 'user_id') {
    const [r] = await getDb()
      .select({ s: sql<number>`coalesce(sum(${aiUsage.costCents}), 0)::int` })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, subject.value), gte(aiUsage.createdAt, since)));
    spent = r?.s ?? 0;
  } else if (subject.type === 'email') {
    const [r] = await getDb()
      .select({ s: sql<number>`coalesce(sum(${aiUsage.costCents}), 0)::int` })
      .from(aiUsage)
      .where(and(eq(aiUsage.email, subject.value), gte(aiUsage.createdAt, since)));
    spent = r?.s ?? 0;
  } else {
    // anon_token: ai_usage has no anon_token column; use building_lookups join
    const [r] = await getDb()
      .select({ s: sql<number>`coalesce(sum(${buildingLookups.aiCostCents}), 0)::int` })
      .from(buildingLookups)
      .where(
        and(
          eq(buildingLookups.anonToken, subject.value),
          gte(buildingLookups.createdAt, since),
        ),
      );
    spent = r?.s ?? 0;
  }

  return spent < cap ? { ok: true } : { ok: false, cap_cents: cap, spent_cents: spent };
}
