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

  it('weAreNotFooter', () => {
    expect(DISCLAIMERS.weAreNotFooter).toBe(extractSection('weAreNotFooter'));
  });
});
