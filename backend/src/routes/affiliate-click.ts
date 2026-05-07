// POST /v1/affiliate/click — records affiliate modal + click-through events.
// Used for Phase 4 (lease review) affiliate partnerships.

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { affiliateClicks } from '../db/schema.js';

const Body = z.object({
  partner: z.enum(['lemonade', 'bellhop', 'moved']),
  referrerUrl: z.string().url().optional(),
  proceeded: z.boolean(),
});

export const affiliateClickRoute = new Hono<{
  Variables: { anonToken: string; userId?: string };
}>();

affiliateClickRoute.post('/affiliate/click', async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ kind: 'invalid_input' }, 400);
  const { partner, referrerUrl, proceeded } = parsed.data;
  await getDb().insert(affiliateClicks).values({
    userId: c.get('userId') ?? null,
    anonToken: c.get('anonToken'),
    partner,
    referrerUrl: referrerUrl ?? '',
    clickedModalAt: new Date(),
    clickedThroughAt: proceeded ? new Date() : null,
  });
  return c.json({ ok: true });
});
