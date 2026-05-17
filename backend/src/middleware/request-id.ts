// Attaches a UUID v4 to every request. Surfaced via the error envelope's
// `requestId` field and via the `X-Request-Id` response header so support
// can correlate a user complaint to a specific log line.

import { createMiddleware } from 'hono/factory';
import { randomUUID } from 'node:crypto';

export const requestIdMiddleware = createMiddleware<{
  Variables: { requestId: string };
}>(async (c, next) => {
  const incoming = c.req.header('x-request-id');
  const id = incoming && incoming.length > 0 && incoming.length < 128 ? incoming : randomUUID();
  c.set('requestId', id);
  c.header('X-Request-Id', id);
  return next();
});
