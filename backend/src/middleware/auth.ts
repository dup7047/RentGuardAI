// Optional JWT verification middleware.
// Reads `Authorization: Bearer <token>` header.
// If valid Supabase JWT: sets userId + userEmail on context.
// If missing or invalid: continues as anonymous (no error thrown).

import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import { logger } from '../logger.js';

const SUPABASE_AUDIENCE = 'authenticated';

const SUPABASE_URL = process.env.SUPABASE_URL;
if (!SUPABASE_URL) {
  throw new Error(
    'SUPABASE_URL is required for JWT verification. Set it in your .env (see backend/.env.example).',
  );
}
const SUPABASE_ISSUER = `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1`;

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length);
    try {
      const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, secret, {
        algorithms: ['HS256'],
        audience: SUPABASE_AUDIENCE,
        issuer: SUPABASE_ISSUER,
      });
      if (typeof payload.sub === 'string') c.set('userId', payload.sub);
      if (typeof payload.email === 'string') c.set('userEmail', payload.email);
    } catch (err) {
      // Invalid token (expired, wrong aud/iss, bad signature) — continue as anon.
      logger.debug({ err: String(err) }, 'jwt verify failed — falling through to anon');
    }
  }
  await next();
});
