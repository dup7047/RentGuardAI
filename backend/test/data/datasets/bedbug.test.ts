import { describe, it, expect, vi, afterEach } from 'vitest';
import { getBedbugReports } from '../../../src/data/datasets/bedbug.js';
import * as cache from '../../../src/data/cache.js';

afterEach(() => vi.restoreAllMocks());

const BBL = '1008440007';
const MOCK = { building_id: 'B1', bbl: BBL, infested_dwelling_unit_count: '3', filing_period: '2023' };

describe('getBedbugReports', () => {
  it('happy path: returns bedbug reports', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([MOCK]), { status: 200 }),
    );
    const rows = await getBedbugReports(BBL);
    expect(rows[0]?.building_id).toBe('B1');
  });

  it('empty result: returns []', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await getBedbugReports(BBL)).toEqual([]);
  });

  it('cache hit: no fetch call', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue([MOCK]);
    const spy = vi.spyOn(global, 'fetch');
    await getBedbugReports(BBL);
    expect(spy).not.toHaveBeenCalled();
  });
});
