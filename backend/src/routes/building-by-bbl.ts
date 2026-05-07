// GET /v1/building/:bbl — public cached building data (no auth required).
// Full implementation in Phase 3.10. Stub returns 200 with empty shape.

import { Hono } from 'hono';
import { getDb } from '../db/client.js';
import { buildings } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export const buildingByBblRoute = new Hono();

buildingByBblRoute.get('/building/:bbl', async (c) => {
  const bbl = c.req.param('bbl');
  const [row] = await getDb()
    .select()
    .from(buildings)
    .where(eq(buildings.bbl, bbl))
    .limit(1);
  if (!row) return c.json({ kind: 'not_found' }, 404);
  return c.json({ kind: 'success', bbl: row.bbl, address: row.address, borough: row.borough });
});
