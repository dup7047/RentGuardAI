// POST /v1/affiliate/click — records affiliate modal + click-through events.
// Used for Phase 4 (lease review) affiliate partnerships.

import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { affiliateClicks } from '../db/schema.js';
import { validate } from '../middleware/validate.js';

const Body = z.object({
  partner: z.enum(['lemonade', 'bellhop', 'moved']),
  referrerUrl: z.string().url().optional(),
  proceeded: z.boolean(),
});

type Vars = { anonToken: string; userId?: string; validated: { body: z.infer<typeof Body> } };

export const affiliateClickRoute = new Hono<{ Variables: Vars }>();

affiliateClickRoute.post('/affiliate/click', validate({ body: Body }), async (c) => {
  const { partner, referrerUrl, proceeded } = c.get('validated').body;
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
