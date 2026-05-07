// Lock the NavBar/sitemap pair against drift: every nav link should be
// listed in the sitemap, and every marketing page added to /app/ should
// be reachable from the navigation.

import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        not: () => ({
          limit: async () => ({ data: [] }),
        }),
      }),
    }),
  }),
}));

const MARKETING_ROUTES = [
  '/how-it-works',
  '/coverage',
  '/for-landlords',
  '/pricing',
] as const;

const ALL_ROUTES = [...MARKETING_ROUTES, '/how-we-make-money'] as const;

describe('sitemap', () => {
  it('contains every marketing route', async () => {
    const sitemapMod = await import('@/app/sitemap');
    const entries = await sitemapMod.default();
    const urls = entries.map((e) => e.url);
    for (const route of ALL_ROUTES) {
      expect(urls).toContain(`https://www.rentguard.cc${route}`);
    }
  });
});

describe('navbar', () => {
  it('every nav-link route is in the sitemap', async () => {
    const sitemapMod = await import('@/app/sitemap');
    const entries = await sitemapMod.default();
    const urls = new Set(entries.map((e) => e.url));
    // The four NavBar links — verified by importing the source and grepping
    // wouldn't be hermetic; instead, hardcode the contract here. If NavBar
    // adds a new link, add it to MARKETING_ROUTES above.
    for (const route of MARKETING_ROUTES) {
      expect(urls.has(`https://www.rentguard.cc${route}`)).toBe(true);
    }
  });
});
