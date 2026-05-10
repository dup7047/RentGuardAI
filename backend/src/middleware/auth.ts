// Optional JWT verification middleware.
// Reads `Authorization: Bearer <token>` header.
// If valid Supabase JWT: sets userId + userEmail on context.
// If missing or invalid: continues as anonymous (no error thrown).
//
// Supports both Supabase JWT signing modes:
//   - Asymmetric (ES256/RS256/EdDSA): tokens verified against the project's
//     JWKS at /auth/v1/.well-known/jwks.json. This is the modern default for
//     newer Supabase projects and is what production uses.
//   - Legacy HMAC (HS256): tokens verified against the shared SUPABASE_JWT_SECRET.
//     Only kept so existing tests (and any project still on legacy mode) work.
//
// On verify failure we log at info with a `reason` tag (`expired`, `bad_iss`,
// `bad_aud`, `bad_signature`, `malformed`, `other`) plus the decoded but
// unverified `iss`/`aud`/`exp` from the failing token. This is what catches
// the env-mismatch class of bug — when the backend's SUPABASE_URL points at
// a different project than the frontend's, every token is rejected with
// reason='bad_iss' and the operator can see it in logs.

import { createMiddleware } from 'hono/factory';
import {
  createRemoteJWKSet,
  decodeJwt,
  jwtVerify,
  type FlattenedJWSInput,
  type JWSHeaderParameters,
} from 'jose';
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

const authConfig = SUPABASE_URL
  ? (() => {
      const baseUrl = SUPABASE_URL.replace(/\/$/, '');
      const issuer = `${baseUrl}/auth/v1`;
      const jwks = createRemoteJWKSet(
        new URL(`${baseUrl}/auth/v1/.well-known/jwks.json`),
      );
      const sharedSecret = SUPABASE_JWT_SECRET
        ? new TextEncoder().encode(SUPABASE_JWT_SECRET)
        : null;

      // Dispatches to HMAC (legacy) or JWKS (asymmetric) based on the JWT's
      // `alg` header. createRemoteJWKSet is lazy — it only fetches when called,
      // so HS-only test setups never hit the network.
      const getKey = async (
        header: JWSHeaderParameters,
        input: FlattenedJWSInput,
      ) => {
        if (header.alg?.startsWith('HS')) {
          if (!sharedSecret) {
            throw new Error(
              'HS-signed JWT received but SUPABASE_JWT_SECRET is not set',
            );
          }
          return sharedSecret;
        }
        return jwks(header, input);
      };

      return { issuer, getKey };
    })()
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
    {
      expectedIssuer: authConfig.issuer,
      expectedAudience: SUPABASE_AUDIENCE,
      legacyHs256Fallback: Boolean(SUPABASE_JWT_SECRET),
    },
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
      const { payload } = await jwtVerify(token, authConfig.getKey, {
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
