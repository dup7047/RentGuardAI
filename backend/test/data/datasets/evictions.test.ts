import { describe, it, expect, vi, afterEach } from 'vitest';
import { getEvictions } from '../../../src/data/datasets/evictions.js';
import * as cache from '../../../src/data/cache.js';

afterEach(() => vi.restoreAllMocks());

const BBL = '1008440007';
const MOCK = { court_index_number: 'EV1', bbl: BBL, residential_commercial_ind: 'Residential' };

describe('getEvictions', () => {
  it('happy path: returns evictions', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([MOCK]), { status: 200 }),
    );
    const rows = await getEvictions(BBL);
    expect(rows[0]?.court_index_number).toBe('EV1');
  });

  it('empty result: returns []', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await getEvictions(BBL)).toEqual([]);
  });

  it('cache hit: no fetch call', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue([MOCK]);
    const spy = vi.spyOn(global, 'fetch');
    await getEvictions(BBL);
    expect(spy).not.toHaveBeenCalled();
  });
});
