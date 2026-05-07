// Verifies the once-per-page reveal contract: a unique text first animates
// from 0 chars, then on a subsequent mount it renders its full length
// immediately (the module-level Set acts as a per-page-load cache).

import { describe, expect, it, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

import { RevealText } from '@/components/RevealText';

afterEach(() => {
  cleanup();
});

describe('RevealText', () => {
  it('first mount of a unique text starts shorter than the full string', () => {
    const text =
      'First-mount text — animates from zero on initial render and is not the full length immediately.';
    const { container } = render(<RevealText text={text} />);
    // Some text may have been written by the synchronous render path, but the
    // component definitely should not render the full string before the
    // animation timers fire.
    expect((container.textContent ?? '').length).toBeLessThan(text.length);
  });

  it('after the animation completes, a second mount of the same text renders fully right away', async () => {
    // Use a short text + fast speed so real timers complete quickly under test.
    const text = 'short';
    const first = render(<RevealText text={text} speed={2} />);
    await waitFor(
      () => {
        expect(first.container.textContent).toContain(text);
      },
      { timeout: 1000 },
    );
    first.unmount();

    // Mount fresh — the module-level Set should now have the text and the
    // very first render should already contain the full string.
    const second = render(<RevealText text={text} speed={2} />);
    expect(second.container.textContent).toContain(text);
  });
});
