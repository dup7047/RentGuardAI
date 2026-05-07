import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHpdViolations } from '../../../src/data/datasets/hpd-violations.js';
import * as cache from '../../../src/data/cache.js';

afterEach(() => {
  vi.restoreAllMocks();
});

const MOCK_BBL = '1008440007';
const MOCK_VIOLATION = { violationid: 'V1', bbl: MOCK_BBL, class: 'C', currentstatus: 'OPEN' };

describe('getHpdViolations', () => {
  it('happy path: mock fetch returns violations array', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([MOCK_VIOLATION]), { status: 200 }),
    );
    const rows = await getHpdViolations(MOCK_BBL);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.violationid).toBe('V1');
  });

  it('empty result: mock fetch returns [] — no throw', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    const rows = await getHpdViolations(MOCK_BBL);
    expect(rows).toEqual([]);
  });

  it('cache hit: returns cached data without calling fetch', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue([MOCK_VIOLATION]);
    const fetchSpy = vi.spyOn(global, 'fetch');
    const rows = await getHpdViolations(MOCK_BBL);
    expect(rows).toEqual([MOCK_VIOLATION]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
