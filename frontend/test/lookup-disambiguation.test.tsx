// Regression test for the address-disambiguation loop.
//
// When a lookup matches multiple buildings the backend returns
// kind:'ambiguous'. The user picks one on the "Pick the right address"
// screen and clicks "Generate report". The bug: the picker re-submitted
// WITHOUT the chosen BBL, so the backend re-ran the same ambiguous match and
// the UI bounced straight back to the picker — an infinite loop.
//
// This renders the real LookupForm and asserts that picking a building
// (a) forwards that building's BBL on the re-submit, and (b) navigates to the
// report instead of redisplaying the picker.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';

import { LookupForm } from '@/app/lookup/LookupForm';

// Stable router push spy so we can assert navigation across renders.
const pushMock = vi.fn();

vi.mock('@/lib/api/geosearch', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/geosearch')>(
    '@/lib/api/geosearch',
  );
  return { ...actual, getAddressSuggestions: vi.fn().mockResolvedValue([]) };
});

vi.mock('@/lib/api/backend', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/api/backend')>('@/lib/api/backend');
  return { ...actual, postLookupStream: vi.fn() };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => new URLSearchParams(),
}));

import * as backend from '@/lib/api/backend';

const MATCHES = [
  { bbl: '4097110030', address: '140-02 84 Drive, Briarwood', borough: 'QUEENS' as const },
  { bbl: '4097110032', address: '140-10 84 Drive, Briarwood', borough: 'QUEENS' as const },
];

function successFor(bbl: string) {
  return {
    kind: 'success',
    bbl,
    address: '140-02 84 Drive',
    borough: 'QUEENS',
    listing_summary: null,
    summary: 'ok',
    score_explanation: null,
    score: 80,
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
    building_url: `/building/${bbl}`,
    value_score: null,
    value_band: null,
    value_confidence: null,
    value_factors: [],
    value_explanation: null,
  } as Awaited<ReturnType<typeof backend.postLookupStream>>;
}

beforeEach(() => {
  vi.useFakeTimers();
  pushMock.mockReset();
  vi.mocked(backend.postLookupStream).mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('LookupForm address disambiguation', () => {
  it('forwards the chosen BBL and navigates (does not loop back to the picker)', async () => {
    // First lookup → ambiguous; the re-submit (with the BBL) → success.
    vi.mocked(backend.postLookupStream)
      .mockResolvedValueOnce({ kind: 'ambiguous', matches: MATCHES } as Awaited<
        ReturnType<typeof backend.postLookupStream>
      >)
      .mockResolvedValueOnce(successFor('4097110030'));

    const { getByLabelText, getByRole, queryByRole } = render(<LookupForm />);
    const input = getByLabelText('NYC listing URL or address') as HTMLInputElement;

    fireEvent.change(input, { target: { value: '84 Drive Briarwood' } });
    fireEvent.click(getByRole('button', { name: /look up/i }));
    await flush();

    // Picker is shown.
    expect(getByRole('heading', { name: /Pick the right address/i })).toBeTruthy();

    // Default selection is the first match; generate the report.
    fireEvent.click(getByRole('button', { name: /generate report/i }));
    await flush();

    // The re-submit carried the chosen BBL — the heart of the fix.
    expect(backend.postLookupStream).toHaveBeenCalledTimes(2);
    expect(vi.mocked(backend.postLookupStream).mock.calls[1]![0]).toMatchObject({
      bbl: '4097110030',
    });

    // We navigated to the report and the picker is gone (no loop).
    expect(pushMock).toHaveBeenCalledWith('/building/4097110030?fresh=1');
    expect(queryByRole('heading', { name: /Pick the right address/i })).toBeNull();
  });
});
