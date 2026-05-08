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

  // Roadmap §pre-launch alignment edits to the Privacy Policy
  // (RENTGUARD_ROADMAP_v6.md lines 840-861).
  describe('privacy.md production-stack alignment', () => {
    const md = readFileSync(join(ROOT, 'docs/legal/privacy.md'), 'utf8');

    it('uses magic-link wording (no plaintext password mention)', () => {
      expect(md).toMatch(/magic-link sign-in/);
      expect(md).not.toMatch(/password \(stored hashed\)/);
    });

    it('documents the anonymous-use flow', () => {
      expect(md).toMatch(/Anonymous use/);
      expect(md).toMatch(/anon_token/);
    });

    it('reflects the production analytics stack (no Plausible reference)', () => {
      expect(md).not.toMatch(/Plausible/i);
      expect(md).toMatch(/Cloudflare Web Analytics/);
      expect(md).toMatch(/PostHog/);
    });
  });
});
