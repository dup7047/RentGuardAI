import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHpdRegistrations, decomposeBbl } from '../../../src/data/datasets/hpd-registrations.js';
import * as cache from '../../../src/data/cache.js';

afterEach(() => vi.restoreAllMocks());

const BBL = '1008440007';
const MOCK_REG = { registrationid: 'R1', bbl: BBL, corporationname: 'EMPIRE LLC' };

describe('decomposeBbl', () => {
  it('splits a 10-digit BBL into boroid + block + lot, stripping leading zeros', () => {
    expect(decomposeBbl('1008350041')).toEqual({ boroid: '1', block: '835', lot: '41' });
    expect(decomposeBbl('3009810111')).toEqual({ boroid: '3', block: '981', lot: '111' });
    expect(decomposeBbl('5000010001')).toEqual({ boroid: '5', block: '1', lot: '1' });
  });

  it('returns null for malformed BBLs', () => {
    expect(decomposeBbl('')).toBeNull();
    expect(decomposeBbl('abc')).toBeNull();
    expect(decomposeBbl('123')).toBeNull();
    expect(decomposeBbl('12345678901')).toBeNull();
  });
});

describe('getHpdRegistrations', () => {
  it('happy path: returns parsed registrations', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([MOCK_REG]), { status: 200 }),
    );
    const rows = await getHpdRegistrations(BBL);
    expect(rows[0]?.registrationid).toBe('R1');
  });

  it('queries by boroid + block + lot (NOT bbl, which the dataset does not expose)', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([]), { status: 200 }),
    );
    await getHpdRegistrations('1008350041');
    const url = (spy.mock.calls[0]?.[0] as URL | string).toString();
    // boroid='1' AND block='835' AND lot='41'  → URL-encoded
    expect(url).toContain("boroid%3D%271%27");
    expect(url).toContain("block%3D%27835%27");
    expect(url).toContain("lot%3D%2741%27");
    // Must NOT use the broken `bbl=` filter
    expect(url).not.toMatch(/bbl%3D/);
  });

  it('empty result: returns []', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await getHpdRegistrations(BBL)).toEqual([]);
  });

  it('malformed BBL: returns [] without hitting fetch', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    const spy = vi.spyOn(global, 'fetch');
    expect(await getHpdRegistrations('not-a-bbl')).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('cache hit: no fetch call', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue([MOCK_REG]);
    const spy = vi.spyOn(global, 'fetch');
    await getHpdRegistrations(BBL);
    expect(spy).not.toHaveBeenCalled();
  });
});
