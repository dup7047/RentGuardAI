// POST /v1/waitlist/email — enroll an email into the Beehiiv waitlist.
// Stub-safe: if env vars are missing, logs intent and returns 200.

import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../logger.js';
import { validate } from '../middleware/validate.js';
import { AppError } from '../lib/errors.js';

const Body = z.object({ email: z.string().email() });

type Vars = { validated: { body: z.infer<typeof Body> } };

export const waitlistEmailRoute = new Hono<{ Variables: Vars }>();

waitlistEmailRoute.post('/waitlist/email', validate({ body: Body }), async (c) => {
  const { email } = c.get('validated').body;

  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUBLICATION_ID;

  if (!apiKey || !pubId) {
    logger.warn({ email }, 'beehiiv stub: would enroll');
    return c.json({ ok: true, stub: true });
  }

  const res = await fetch(
    `https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ email, reactivate_existing: true, send_welcome_email: true }),
    },
  );

  if (!res.ok) {
    throw new AppError('internal_error', `Waitlist provider returned ${res.status}.`);
  }
  return c.json({ ok: true });
});
