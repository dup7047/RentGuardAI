// Optional JWT verification middleware.
// Reads `Authorization: Bearer <token>` header.
// If valid Supabase JWT: sets userId + userEmail on context.
// If missing or invalid: continues as anonymous (no error thrown).

import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import { logger } from '../logger.js';

const SUPABASE_AUDIENCE = 'authenticated';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;
const authConfig =
  SUPABASE_URL && SUPABASE_JWT_SECRET
    ? {
        issuer: `${SUPABASE_URL.replace(/\/$/, '')}/auth/v1`,
        secret: new TextEncoder().encode(SUPABASE_JWT_SECRET),
      }
    : null;

if (!authConfig) {
  logger.warn(
    {
      missingSupabaseUrl: !SUPABASE_URL,
      missingSupabaseJwtSecret: !SUPABASE_JWT_SECRET,
    },
    'supabase jwt verification disabled; requests will continue as anonymous',
  );
}

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  if (authConfig && header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length);
    try {
      const { payload } = await jwtVerify(token, authConfig.secret, {
        algorithms: ['HS256'],
        audience: SUPABASE_AUDIENCE,
        issuer: authConfig.issuer,
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
