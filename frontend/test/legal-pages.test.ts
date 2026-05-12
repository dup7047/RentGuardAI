// Sanity-check the long-form legal documents that back /legal/terms,
// /legal/privacy, and /legal/disclaimer.

import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const ROOT = join(import.meta.dirname, '../..');
const SLUGS = ['terms', 'privacy', 'disclaimer'] as const;

describe('legal long-form documents', () => {
  for (const slug of SLUGS) {
    describe(slug, () => {
      const file = join(ROOT, 'docs/legal', `${slug}.md`);

      it('exists on disk', () => {
        expect(() => statSync(file)).not.toThrow();
      });

      it('is non-trivially sized', () => {
        // Tripwire for accidental truncation. The shortest doc (disclaimer)
        // is ~9KB; the others are ~13KB. 4KB is a safe floor.
        const bytes = statSync(file).size;
        expect(bytes).toBeGreaterThan(4_000);
      });

      it('declares a Last updated line', () => {
        const md = readFileSync(file, 'utf8');
        expect(md).toMatch(/^\*\*Last updated:\*\*/m);
      });

      it('starts with an H1 title', () => {
        const md = readFileSync(file, 'utf8');
        expect(md).toMatch(/^# /);
      });
    });
  }

  describe('privacy.md production-stack alignment', () => {
    const md = readFileSync(join(ROOT, 'docs/legal/privacy.md'), 'utf8');

    it('documents password and magic-link auth without plaintext password storage claims', () => {
      expect(md).toMatch(/password sign-in/);
      expect(md).toMatch(/magic-link sign-in/);
      expect(md).not.toMatch(/password \(stored hashed\)/);
    });

    it('documents the anonymous-use flow', () => {
      expect(md).toMatch(/Anonymous use/);
      expect(md).toMatch(/anon_token/);
    });

    it('names Cloudflare Web Analytics (deployed in Phase 11.8) and no analytics vendor we have not deployed', () => {
      // Phase 11.5/11.8: privacy.md must name the vendor we actually ship.
      expect(md).toMatch(/Cloudflare Web Analytics/);
      // Vendors we are NOT shipping in v7 must not be named — listing a
      // tool we do not use would misstate the data flow.
      expect(md).not.toMatch(/Plausible/i);
      expect(md).not.toMatch(/PostHog/);
    });

    it('keeps unavailable product data flows framed as not collected today', () => {
      expect(md).toMatch(/does not currently offer lease upload/);
      expect(md).toMatch(/do not currently collect lease PDFs/);
      expect(md).not.toMatch(/Anthropic|Claude|rentguard\.nyc/);
    });
  });
});
