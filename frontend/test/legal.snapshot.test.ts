// Verify that the generated disclaimers.json matches the markdown source.
// If this test fails, run `npm run build:disclaimers` to regenerate.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');
const md = readFileSync(join(ROOT, 'docs/legal/disclaimers.md'), 'utf8');

function extractSection(anchor: string): string {
  const re = new RegExp(
    `<!-- BEGIN ${anchor} -->\\n([\\s\\S]*?)\\n<!-- END ${anchor} -->`,
    'm',
  );
  const m = md.match(re);
  if (!m) throw new Error(`section ${anchor} not found`);
  return m[1].trim();
}

// Dynamic import so the JSON is read at test time (after build:disclaimers)
const { DISCLAIMERS } = await import('@/lib/legal/disclaimers');

describe('disclaimers.json matches markdown source', () => {
  it('preOutputFraming', () => {
    expect(DISCLAIMERS.preOutputFraming).toBe(extractSection('preOutputFraming'));
  });

  it('fareActFraming', () => {
    expect(DISCLAIMERS.fareActFraming).toBe(extractSection('fareActFraming'));
  });

  it('affiliateClickThrough', () => {
    expect(DISCLAIMERS.affiliateClickThrough).toBe(extractSection('affiliateClickThrough'));
  });

  it('affiliateLongForm', () => {
    expect(DISCLAIMERS.affiliateLongForm).toBe(extractSection('affiliateLongForm'));
  });

  it('weAreNotFooter', () => {
    expect(DISCLAIMERS.weAreNotFooter).toBe(extractSection('weAreNotFooter'));
  });
});

// Phase 11.6 acceptance: the /how-we-make-money page must render
// disclaimer.md §4.2 (long-form transparency language) byte-for-byte.
// disclaimer.md is the attorney-approved source; disclaimers.md mirrors
// the §4.2 block under the affiliateLongForm anchor.
describe('disclaimer.md §4.2 matches the affiliateLongForm anchor', () => {
  it('long-form transparency text round-trips between disclaimer.md and disclaimers.md', () => {
    const disclaimerMd = readFileSync(join(ROOT, 'docs/legal/disclaimer.md'), 'utf8');
    // Pull the §4.2 block: everything from "### 4.2" heading down to the
    // next heading. Strip "> " quote prefixes and trim, matching the
    // shape inside disclaimers.md.
    const match = disclaimerMd.match(/### 4\.2[^\n]*\n([\s\S]*?)(?=\n### |\n## |\n---)/);
    if (!match) throw new Error('§4.2 not found in disclaimer.md');
    const fromDisclaimer = match[1]
      .split('\n')
      .map((l) => l.replace(/^> ?/, ''))
      .join('\n')
      .trim();
    expect(DISCLAIMERS.affiliateLongForm).toBe(fromDisclaimer);
  });
});
