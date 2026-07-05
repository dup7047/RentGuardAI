// seoAnonToken: the SEO regeneration path's cost-cap subject. Must be a
// valid UUID (anon_token columns are uuid-typed — the old `seo:<bbl>`
// string threw 22P02 on every cost-cap query) and stable per BBL so the
// per-building daily cap accrues.

import { describe, it, expect } from 'vitest';
import { seoAnonToken } from '../src/routes/building-by-bbl.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('seoAnonToken', () => {
  it('produces a valid UUID shape', () => {
    expect(seoAnonToken('1008420015')).toMatch(UUID_RE);
  });

  it('is deterministic per BBL and distinct across BBLs', () => {
    expect(seoAnonToken('1008420015')).toBe(seoAnonToken('1008420015'));
    expect(seoAnonToken('1008420015')).not.toBe(seoAnonToken('2022940002'));
  });
});
