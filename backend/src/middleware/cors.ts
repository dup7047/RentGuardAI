// CORS policy for the RentGuard backend.
// Allows local dev origins, production domain, and Vercel preview URLs.

import { cors } from 'hono/cors';

const ALLOWED = [
  'http://localhost:3000',
  'http://localhost:3100',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3100',
  'https://rentguard.cc',
  'https://www.rentguard.cc',
];

export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return '*';
    if (ALLOWED.includes(origin)) return origin;
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;
    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
});
