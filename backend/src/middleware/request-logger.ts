import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { logger } from '../logger.js';

export const REQUEST_ID_HEADER = 'x-request-id';

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const incoming = c.req.header(REQUEST_ID_HEADER);
  const requestId = incoming && incoming.length > 0 ? incoming : randomUUID();
  c.set('requestId', requestId);
  c.header(REQUEST_ID_HEADER, requestId);

  const start = performance.now();
  const child = logger.child({ requestId });

  try {
    await next();
  } finally {
    const duration = Math.round((performance.now() - start) * 100) / 100;
    child.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: duration,
      },
      'request completed'
    );
  }
};

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}
