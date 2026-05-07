// POST /v1/waitlist/email — enroll an email into the Beehiiv waitlist.
// Stub-safe: if env vars are missing, logs intent and returns 200.

import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../logger.js';

const Body = z.object({ email: z.string().email() });

export const waitlistEmailRoute = new Hono();

waitlistEmailRoute.post('/waitlist/email', async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ kind: 'invalid_input' }, 400);
  const { email } = parsed.data;

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

  if (!res.ok) return c.json({ ok: false, status: res.status }, 502);
  return c.json({ ok: true });
});
