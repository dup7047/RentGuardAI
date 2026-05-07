// Verifies the NYC Geosearch autocomplete client:
//   - Maps API features → display-friendly suggestions
//   - Drops features missing a BBL (non-NYC results)
//   - Title-cases the primary line
//   - Title-cases the display string we put in the input
//   - LRU cache: identical query in succession only fetches once
//   - Returns [] on network / parse failure (no throw)
//   - Re-throws AbortError when the signal is aborted

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

import {
  getAddressSuggestions,
  __clearGeosearchCache,
} from '@/lib/api/geosearch';

const ORIGINAL_FETCH = globalThis.fetch;

function makeFeature(overrides: Partial<{
  housenumber: string;
  street: string;
  label: string;
  borough: string;
  neighbourhood: string;
  bbl: string | null;
}> = {}) {
  return {
    properties: {
      label: overrides.label ?? '350 5 AVENUE, New York, NY, USA',
      housenumber: overrides.housenumber ?? '350',
      street: overrides.street ?? '5 AVENUE',
      borough: overrides.borough ?? 'Manhattan',
      neighbourhood: overrides.neighbourhood ?? 'Midtown West',
      addendum:
        overrides.bbl === null
          ? undefined
          : { pad: { bbl: overrides.bbl ?? '1008350041' } },
    },
  };
}

function mockResponse(features: ReturnType<typeof makeFeature>[]): Response {
  return new Response(JSON.stringify({ features }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  __clearGeosearchCache();
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('getAddressSuggestions', () => {
  it('title-cases the primary line and builds a "primary, neighbourhood, borough" display', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(mockResponse([makeFeature()]));

    const list = await getAddressSuggestions('350 5th ave');

    expect(list).toHaveLength(1);
    expect(list[0].primary).toBe('350 5 Avenue');
    expect(list[0].secondary).toBe('Midtown West, Manhattan');
    expect(list[0].display).toBe('350 5 Avenue, Midtown West, Manhattan');
    expect(list[0].bbl).toBe('1008350041');
  });

  it('falls back to "borough" alone when neighbourhood is missing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse([
        makeFeature({ neighbourhood: '', borough: 'Brooklyn' }),
      ]),
    );

    const list = await getAddressSuggestions('350 5th ave');
    expect(list[0].secondary).toBe('Brooklyn');
    expect(list[0].display).toBe('350 5 Avenue, Brooklyn');
  });

  it('drops features missing addendum.pad.bbl', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      mockResponse([
        makeFeature({ bbl: '1008350041' }),
        makeFeature({ bbl: null, label: 'Some address outside NYC' }),
        makeFeature({ bbl: '3009810111' }),
      ]),
    );

    const list = await getAddressSuggestions('350 5th ave');
    expect(list.map((s) => s.bbl)).toEqual(['1008350041', '3009810111']);
  });

  it('caches identical queries: second call does not refetch', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse([makeFeature()]));
    globalThis.fetch = fetchMock;

    await getAddressSuggestions('350 5th ave');
    await getAddressSuggestions('350 5th ave'); // same query
    await getAddressSuggestions('  350 5TH AVE  '); // same after trim+lower

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns [] on a non-OK response (no throw)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('oops', { status: 500 }));

    const list = await getAddressSuggestions('350 5th ave');
    expect(list).toEqual([]);
  });

  it('returns [] on network failure (no throw)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
    const list = await getAddressSuggestions('350 5th ave');
    expect(list).toEqual([]);
  });

  it('re-throws AbortError when the signal aborts mid-fetch', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);

    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      getAddressSuggestions('350 5th ave', ctrl.signal),
    ).rejects.toThrow(/aborted/);
  });

  it('returns [] for an empty/whitespace-only query without fetching', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    expect(await getAddressSuggestions('')).toEqual([]);
    expect(await getAddressSuggestions('   ')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
