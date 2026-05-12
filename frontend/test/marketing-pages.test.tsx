// Smoke tests for the five marketing pages added in this batch.
// Asserts each page renders, includes the LegalFooter text from disclaimers.md,
// and links back to the home page or the right mailto: target.

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import { DISCLAIMERS } from '@/lib/legal/disclaimers';

import HowItWorksPage from '@/app/how-it-works/page';
import CoveragePage from '@/app/coverage/page';
import ForLandlordsPage from '@/app/for-landlords/page';
import PricingPage from '@/app/pricing/page';
import HowWeMakeMoneyPage from '@/app/how-we-make-money/page';

afterEach(() => {
  cleanup();
});

function legalFooterPresent(container: HTMLElement) {
  return container.textContent?.includes(DISCLAIMERS.weAreNotFooter) === true;
}

function hrefs(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
}

describe('marketing pages', () => {
  it('how-it-works renders, has legal footer, and CTAs to /', () => {
    const { container } = render(<HowItWorksPage />);
    expect(legalFooterPresent(container)).toBe(true);
    expect(hrefs(container)).toContain('/');
    expect(container.textContent).toContain('How RentGuard works');
  });

  it('coverage lists nine NYC Open Data sources and CTAs to /', () => {
    const { container } = render(<CoveragePage />);
    expect(legalFooterPresent(container)).toBe(true);
    expect(hrefs(container)).toContain('/');
    expect(container.textContent).toContain('HPD Housing Maintenance Code Violations');
    expect(container.textContent).toContain('Worst Landlord Watchlist');
  });

  it('for-landlords is informational with no paid CTA', () => {
    const { container } = render(<ForLandlordsPage />);
    expect(legalFooterPresent(container)).toBe(true);
    const text = container.textContent ?? '';
    // Roadmap §1.3 defamation posture: page must explicitly disclaim
    // first-party labels (the words appear inside quotes in the negation).
    expect(text).toContain('We never use first-party labels');
    // Has a corrections mailto.
    expect(hrefs(container).some((h) => h.startsWith('mailto:corrections@'))).toBe(true);
  });

  it('pricing shows "Coming soon — join waitlist" chips and never says Subscribe/Buy/Preorder', () => {
    const { container } = render(<PricingPage />);
    expect(legalFooterPresent(container)).toBe(true);
    const text = container.textContent ?? '';
    expect(text).toContain('Coming soon');
    expect(text).toContain('Join research list');
    // FTC mail-order rules attach to "preorder"; CTAs must not say Subscribe/Buy/Preorder.
    expect(text).not.toMatch(/Preorder|Subscribe now|Buy now/i);
    // Planned tools are waitlist-only mailto links, not live purchase/login flows.
    const hs = hrefs(container);
    expect(hs.some((h) => h.startsWith('mailto:lease-review-waitlist@'))).toBe(true);
    expect(hs.some((h) => h.startsWith('mailto:search-pass-waitlist@'))).toBe(true);
    expect(hs).not.toContain('/login?redirectTo=/dashboard');
  });

  it('how-we-make-money renders the §4.2 long-form affiliate disclosure verbatim', () => {
    // Phase 11.6 acceptance: the page must render disclaimer.md §4.2
    // (long-form transparency language), not the §4.1 click-through
    // language used in the modal. Each of the three paragraphs is
    // rendered as its own <p>, so we check each paragraph independently
    // instead of the joined source — whitespace around <p> boundaries
    // does not survive textContent concatenation.
    const { container } = render(<HowWeMakeMoneyPage />);
    expect(legalFooterPresent(container)).toBe(true);
    const text = container.textContent ?? '';
    for (const paragraph of DISCLAIMERS.affiliateLongForm.split(/\n\n+/)) {
      expect(text).toContain(paragraph);
    }
    expect(text).toContain('Lemonade');
    expect(text).toContain('Bellhop');
    expect(text).toContain('Moved');
  });
});
