// Lookup usage counters.
// anon: counted via building_lookups rows (no email).
// email: counted via email_lookup_counters; resets every 30 days.
// user_id (logged-in): unlimited on the free tier.

import { getDb } from '../db/client.js';
import { emailLookupCounters, buildingLookups } from '../db/schema.js';
import { eq, sql, and, isNull } from 'drizzle-orm';

export const FREE_ANON_LIMIT = 3;
export const FREE_EMAIL_LIMIT_30D = 3;
const RESET_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export const LIMITS = { FREE_ANON_LIMIT, FREE_EMAIL_LIMIT_30D, RESET_INTERVAL_MS } as const;

export async function countAnonLookups(anonToken: string): Promise<number> {
  const [r] = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(buildingLookups)
    .where(and(eq(buildingLookups.anonToken, anonToken), isNull(buildingLookups.email)));
  return r?.c ?? 0;
}

export async function countEmailLookups(email: string): Promise<number> {
  const [r] = await getDb()
    .select()
    .from(emailLookupCounters)
    .where(eq(emailLookupCounters.email, email))
    .limit(1);
  if (!r) return 0;
  if (Date.now() - r.resetAt.getTime() > RESET_INTERVAL_MS) return 0;
  return r.count30d;
}

export async function incrementEmailCounter(
  email: string,
  anonToken: string | null,
): Promise<void> {
  await getDb()
    .insert(emailLookupCounters)
    .values({ email, count30d: 1, resetAt: new Date(), anonToken: anonToken ?? '' })
    .onConflictDoUpdate({
      target: emailLookupCounters.email,
      set: {
        count30d: sql`CASE WHEN ${emailLookupCounters.resetAt} < NOW() - interval '30 days' THEN 1 ELSE ${emailLookupCounters.count30d} + 1 END`,
        resetAt: sql`CASE WHEN ${emailLookupCounters.resetAt} < NOW() - interval '30 days' THEN NOW() ELSE ${emailLookupCounters.resetAt} END`,
        anonToken: anonToken ?? '',
      },
    });
}
