// Sets or reads the `rentguard-anon` cookie.
// Assigns a stable anonymous identifier for rate-limiting and cost tracking
// when the user is not authenticated.

import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';

const COOKIE = 'rentguard-anon';
const TTL_S = 60 * 60 * 24 * 365; // 12 months — matches Privacy Policy §6.1

export const anonTokenMiddleware = createMiddleware(async (c, next) => {
  let token = getCookie(c, COOKIE);
  if (!token) {
    token = randomUUID();
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: TTL_S,
    });
  }
  c.set('anonToken', token);
  await next();
});
