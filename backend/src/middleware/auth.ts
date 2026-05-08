// Optional JWT verification middleware.
// Reads `Authorization: Bearer <token>` header.
// If valid Supabase JWT: sets userId + userEmail on context.
// If missing or invalid: continues as anonymous (no error thrown).
//
// On verify failure we log at info with a `reason` tag (`expired`, `bad_iss`,
// `bad_aud`, `bad_signature`, `malformed`, `other`) plus the decoded but
// unverified `iss`/`aud`/`exp` from the failing token. This is what catches
// the env-mismatch class of bug — when the backend's SUPABASE_URL points at
// a different project than the frontend's, every token is rejected with
// reason='bad_iss' and the operator can see it in logs.

import { createMiddleware } from 'hono/factory';
import { decodeJwt, jwtVerify } from 'jose';
import {
  JOSEError,
  JWSSignatureVerificationFailed,
  JWTClaimValidationFailed,
  JWTExpired,
  JWTInvalid,
} from 'jose/errors';
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
} else {
  logger.info(
    { expectedIssuer: authConfig.issuer, expectedAudience: SUPABASE_AUDIENCE },
    'supabase jwt verification enabled',
  );
}

type FailureReason =
  | 'expired'
  | 'bad_iss'
  | 'bad_aud'
  | 'bad_signature'
  | 'malformed'
  | 'other';

function classifyFailure(err: unknown): FailureReason {
  if (err instanceof JWTExpired) return 'expired';
  if (err instanceof JWTClaimValidationFailed) {
    if (err.claim === 'iss') return 'bad_iss';
    if (err.claim === 'aud') return 'bad_aud';
    return 'other';
  }
  if (err instanceof JWSSignatureVerificationFailed) return 'bad_signature';
  if (err instanceof JWTInvalid) return 'malformed';
  if (err instanceof JOSEError) return 'other';
  return 'other';
}

function safeDecode(token: string): {
  iss?: unknown;
  aud?: unknown;
  exp?: unknown;
} {
  try {
    const claims = decodeJwt(token);
    return { iss: claims.iss, aud: claims.aud, exp: claims.exp };
  } catch {
    return {};
  }
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
      const reason = classifyFailure(err);
      const decoded = safeDecode(token);
      logger.info(
        {
          reason,
          expectedIss: authConfig.issuer,
          expectedAud: SUPABASE_AUDIENCE,
          gotIss: decoded.iss,
          gotAud: decoded.aud,
          expMs: typeof decoded.exp === 'number' ? decoded.exp * 1000 : null,
          err: String(err),
        },
        'jwt verify failed — continuing as anon',
      );
    }
  }
  await next();
});
