// Optional JWT verification middleware.
// Reads `Authorization: Bearer <token>` header.
// If valid Supabase JWT: sets userId + userEmail on context.
// If missing or invalid: continues as anonymous (no error thrown).

import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length);
    try {
      const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
      if (typeof payload.sub === 'string') c.set('userId', payload.sub);
      if (typeof payload.email === 'string') c.set('userEmail', payload.email);
    } catch {
      // Invalid token — continue as anon. Not an error condition.
    }
  }
  await next();
});
