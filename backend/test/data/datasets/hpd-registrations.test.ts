import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHpdRegistrations } from '../../../src/data/datasets/hpd-registrations.js';
import * as cache from '../../../src/data/cache.js';

afterEach(() => vi.restoreAllMocks());

const BBL = '1008440007';
const MOCK_REG = { registrationid: 'R1', bbl: BBL, corporationname: 'EMPIRE LLC' };

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

  it('empty result: returns []', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await getHpdRegistrations(BBL)).toEqual([]);
  });

  it('cache hit: no fetch call', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue([MOCK_REG]);
    const spy = vi.spyOn(global, 'fetch');
    await getHpdRegistrations(BBL);
    expect(spy).not.toHaveBeenCalled();
  });
});
