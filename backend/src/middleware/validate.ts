// Zod-validated request middleware. Throws AppError('validation_failed')
// on parse failure; the global onError handler in app.ts renders the
// envelope. On success, parsed values are attached to context under
// `validated.body|query|params` so handlers stay free of safeParse
// boilerplate.
//
// Usage:
//   route.post('/x', validate({ body: Schema }), async (c) => {
//     const body = c.get('validated').body;
//     ...
//   });

import { createMiddleware } from 'hono/factory';
import type { ZodTypeAny, z } from 'zod';
import { fromZodIssues } from '../lib/errors.js';

export type ValidatedFor<T extends ValidateSchemas> = {
  body: T['body'] extends ZodTypeAny ? z.infer<T['body']> : undefined;
  query: T['query'] extends ZodTypeAny ? z.infer<T['query']> : undefined;
  params: T['params'] extends ZodTypeAny ? z.infer<T['params']> : undefined;
};

export type ValidateSchemas = {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
};

export function validate<T extends ValidateSchemas>(schemas: T) {
  return createMiddleware<{
    Variables: { validated: ValidatedFor<T> };
  }>(async (c, next) => {
    const validated: { body?: unknown; query?: unknown; params?: unknown } = {};

    if (schemas.body) {
      const raw = await c.req.json().catch(() => ({}));
      const r = schemas.body.safeParse(raw);
      if (!r.success) throw fromZodIssues(r.error.issues);
      validated.body = r.data;
    }
    if (schemas.query) {
      const r = schemas.query.safeParse(Object.fromEntries(new URL(c.req.url).searchParams));
      if (!r.success) throw fromZodIssues(r.error.issues);
      validated.query = r.data;
    }
    if (schemas.params) {
      const r = schemas.params.safeParse(c.req.param());
      if (!r.success) throw fromZodIssues(r.error.issues);
      validated.params = r.data;
    }

    c.set('validated', validated as ValidatedFor<T>);
    return next();
  });
}
