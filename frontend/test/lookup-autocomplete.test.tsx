// Integration test for LookupForm + autocomplete.
// Verifies that the form fetches suggestions on the right cadence,
// hides the dropdown for URLs, and routes ArrowDown+Enter through
// the picked-suggestion submit path.
//
// We mock both the geosearch helper (synchronous control over results)
// and the lookup-stream helper (so we never touch the network).

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

import { LookupForm } from '@/app/lookup/LookupForm';
import type { AddressSuggestion } from '@/lib/api/geosearch';

// ── Mocks ────────────────────────────────────────────────────────────────
vi.mock('@/lib/api/geosearch', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/geosearch')>(
    '@/lib/api/geosearch',
  );
  return {
    ...actual,
    getAddressSuggestions: vi.fn(),
  };
});

vi.mock('@/lib/api/backend', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api/backend')>('@/lib/api/backend');
  return {
    ...actual,
    postLookupStream: vi.fn(),
  };
});

// next/navigation is not available in jsdom; stub useRouter and
// useSearchParams (LookupForm seeds its input from ?q= via the latter).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import * as geosearch from '@/lib/api/geosearch';
import * as backend from '@/lib/api/backend';

const SAMPLE: AddressSuggestion[] = [
  {
    bbl: '1008350041',
    primary: '350 5 Avenue',
    secondary: 'Midtown West, Manhattan',
    display: '350 5 Avenue, Midtown West, Manhattan',
  },
  {
    bbl: '3009810111',
    primary: '350 5 Avenue',
    secondary: 'Park Slope, Brooklyn',
    display: '350 5 Avenue, Park Slope, Brooklyn',
  },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(geosearch.getAddressSuggestions).mockReset();
  vi.mocked(geosearch.getAddressSuggestions).mockResolvedValue(SAMPLE);
  vi.mocked(backend.postLookupStream).mockReset();
  vi.mocked(backend.postLookupStream).mockResolvedValue({
    kind: 'success',
    bbl: '1008350041',
    address: '350 5 AVENUE',
    borough: 'Manhattan',
    listing_summary: null,
    summary: 'ok',
    score_explanation: null,
    score: 95,
    score_band: 'minimal',
    score_factors: [],
    indicators: [],
    questions_to_ask: [],
    listing_notes: [],
    scraped_listing: null,
    landlord: {},
    fare_check: null,
    stats: {},
    lookup_id: null,
    building_url: '/building/1008350041',
    value_score: null,
    value_band: null,
    value_confidence: null,
    value_factors: [],
    value_explanation: null,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Advance fake timers and flush microtasks until the React state has settled. */
async function flush(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('LookupForm autocomplete', () => {
  it('does not fetch suggestions for input shorter than 3 chars', async () => {
    const { getByLabelText } = render(<LookupForm />);
    const input = getByLabelText('NYC listing URL or address') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '12' } });
    await flush(500);

    expect(geosearch.getAddressSuggestions).not.toHaveBeenCalled();
  });

  it('fetches suggestions after the debounce when input >= 3 chars', async () => {
    const { getByLabelText, container } = render(<LookupForm />);
    const input = getByLabelText('NYC listing URL or address') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '350' } });
    await flush(200);

    expect(geosearch.getAddressSuggestions).toHaveBeenCalledWith(
      '350',
      expect.any(AbortSignal),
    );
    expect(container.querySelector('#address-suggestions')).toBeTruthy();
  });

  it('hides the dropdown when input becomes a URL', async () => {
    const { getByLabelText, container } = render(<LookupForm />);
    const input = getByLabelText('NYC listing URL or address') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '350 5th' } });
    await flush(200);
    expect(container.querySelector('#address-suggestions')).toBeTruthy();

    fireEvent.change(input, {
      target: { value: 'https://streeteasy.com/foo' },
    });
    await flush(200);
    expect(container.querySelector('#address-suggestions')).toBeNull();
  });

  it('ArrowDown then Enter picks the highlighted suggestion (submits its display)', async () => {
    const { getByLabelText, container } = render(<LookupForm />);
    const input = getByLabelText('NYC listing URL or address') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '350 5th' } });
    await flush(200);
    expect(container.querySelector('#address-suggestions')).toBeTruthy();

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    // submit() awaits postLookupStream — flush any pending microtasks.
    await flush(0);

    expect(backend.postLookupStream).toHaveBeenCalledWith(
      expect.objectContaining({
        address: '350 5 Avenue, Midtown West, Manhattan',
      }),
      expect.any(Function),
    );
  });
});
