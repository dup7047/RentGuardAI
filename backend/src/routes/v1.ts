// v1 API router — mounts all /v1/* routes.
// Middleware (cors, anon-token, auth, rate-limit) is applied in app.ts.

import { Hono } from 'hono';
import { lookupRoute } from './lookup.js';
import { affiliateClickRoute } from './affiliate-click.js';
import { waitlistEmailRoute } from './waitlist-email.js';
import { buildingByBblRoute } from './building-by-bbl.js';
import { savedBuildingsRoute } from './saved-buildings.js';
import { accountRoute } from './account.js';

export const v1Router = new Hono<{
  Variables: { anonToken: string; userId?: string; userEmail?: string };
}>();

v1Router.route('/', lookupRoute);
v1Router.route('/', affiliateClickRoute);
v1Router.route('/', waitlistEmailRoute);
v1Router.route('/', buildingByBblRoute);
v1Router.route('/', savedBuildingsRoute);
v1Router.route('/', accountRoute);
