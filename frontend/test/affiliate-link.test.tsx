// Phase 11.6: AffiliateLink behavior tests.
// Covers feature-flag gating, disclosure-modal rendering, and the two-event
// logging contract (modal-open + click-through).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import { DISCLAIMERS } from '@/lib/legal/disclaimers';

const postAffiliateClick = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/api/backend', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/backend')>('@/lib/api/backend');
  return {
    ...actual,
    postAffiliateClick: (...args: unknown[]) => postAffiliateClick(...args),
  };
});

const originalEnabled = process.env.NEXT_PUBLIC_AFFILIATE_ENABLED;

beforeEach(() => {
  postAffiliateClick.mockClear();
});

afterEach(() => {
  cleanup();
  process.env.NEXT_PUBLIC_AFFILIATE_ENABLED = originalEnabled;
});

describe('AffiliateLink (disabled / v7 default)', () => {
  it('renders a "Coming soon" pill and does not log when the flag is off', async () => {
    process.env.NEXT_PUBLIC_AFFILIATE_ENABLED = 'false';
    const { AffiliateLink } = await import('@/components/AffiliateLink');
    render(<AffiliateLink partner="lemonade" href="https://lemonade.com" label="Visit Lemonade" />);
    expect(screen.getByText(/coming soon/i)).toBeTruthy();
    expect(postAffiliateClick).not.toHaveBeenCalled();
  });
});

describe('AffiliateLink (enabled)', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_AFFILIATE_ENABLED = 'true';
    vi.resetModules();
  });

  it('opens the modal on click and logs the modal-open event', async () => {
    const { AffiliateLink } = await import('@/components/AffiliateLink');
    render(<AffiliateLink partner="lemonade" href="https://lemonade.com" label="Visit Lemonade" />);
    fireEvent.click(screen.getByRole('button', { name: /visit lemonade/i }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    // Disclosure copy comes from disclaimers.json (byte-for-byte mirror of §4.1)
    expect(screen.getByText(DISCLAIMERS.affiliateClickThrough)).toBeTruthy();
    expect(postAffiliateClick).toHaveBeenCalledWith({ partner: 'lemonade', proceeded: false });
  });

  it('logs the click-through event when Continue is pressed', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const { AffiliateLink } = await import('@/components/AffiliateLink');
    render(<AffiliateLink partner="lemonade" href="https://lemonade.com" label="Visit Lemonade" />);
    fireEvent.click(screen.getByRole('button', { name: /visit lemonade/i }));
    fireEvent.click(screen.getByRole('button', { name: /continue to lemonade/i }));
    // Two events total: modal-open + click-through with proceeded: true.
    // window.open is invoked after the click-through log resolves — wait for
    // both effects in one assertion so we don't race the async handler.
    await vi.waitFor(() => {
      expect(postAffiliateClick).toHaveBeenCalledTimes(2);
      expect(openSpy).toHaveBeenCalledWith(
        'https://lemonade.com',
        '_blank',
        'noopener,noreferrer',
      );
    });
    expect(postAffiliateClick).toHaveBeenLastCalledWith({
      partner: 'lemonade',
      referrerUrl: 'https://lemonade.com',
      proceeded: true,
    });
    openSpy.mockRestore();
  });

  it('closes the modal on Cancel without logging a second event', async () => {
    const { AffiliateLink } = await import('@/components/AffiliateLink');
    render(<AffiliateLink partner="bellhop" href="https://bellhop.com" label="Visit Bellhop" />);
    fireEvent.click(screen.getByRole('button', { name: /visit bellhop/i }));
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(postAffiliateClick).toHaveBeenCalledTimes(1); // modal-open only
  });
});
