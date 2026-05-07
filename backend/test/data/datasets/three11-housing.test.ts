import { describe, it, expect, vi, afterEach } from 'vitest';
import { get311HousingRequests } from '../../../src/data/datasets/three11-housing.js';
import * as cache from '../../../src/data/cache.js';

afterEach(() => vi.restoreAllMocks());

const BBL = '1008440007';
const MOCK = { unique_key: 'K1', bbl: BBL, agency: 'HPD', complaint_type: 'HEAT/HOT WATER' };

describe('get311HousingRequests', () => {
  it('happy path: returns 311 requests', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([MOCK]), { status: 200 }),
    );
    const rows = await get311HousingRequests(BBL);
    expect(rows[0]?.unique_key).toBe('K1');
  });

  it('empty result: returns []', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await get311HousingRequests(BBL)).toEqual([]);
  });

  it('cache hit: no fetch call', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue([MOCK]);
    const spy = vi.spyOn(global, 'fetch');
    await get311HousingRequests(BBL);
    expect(spy).not.toHaveBeenCalled();
  });
});
