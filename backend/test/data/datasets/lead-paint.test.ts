import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLeadPaintViolations } from '../../../src/data/datasets/lead-paint.js';
import * as cache from '../../../src/data/cache.js';

afterEach(() => vi.restoreAllMocks());

const BBL = '1008440007';
const MOCK = { violationid: 'LP1', bbl: BBL, class: 'C', currentstatus: 'OPEN' };

describe('getLeadPaintViolations', () => {
  it('happy path: returns lead paint violations', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([MOCK]), { status: 200 }),
    );
    const rows = await getLeadPaintViolations(BBL);
    expect(rows[0]?.violationid).toBe('LP1');
  });

  it('empty result: returns []', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await getLeadPaintViolations(BBL)).toEqual([]);
  });

  it('cache hit: no fetch call', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue([MOCK]);
    const spy = vi.spyOn(global, 'fetch');
    await getLeadPaintViolations(BBL);
    expect(spy).not.toHaveBeenCalled();
  });
});
