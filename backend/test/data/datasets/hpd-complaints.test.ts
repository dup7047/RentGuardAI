import { describe, it, expect, vi, afterEach } from 'vitest';
import { getHpdComplaints } from '../../../src/data/datasets/hpd-complaints.js';
import * as cache from '../../../src/data/cache.js';

afterEach(() => vi.restoreAllMocks());

const BBL = '1013950055';
const MOCK = {
  complaintid: 'C1',
  bbl: BBL,
  apartment: '2L',
  receiveddate: '2026-04-27T00:00:00.000',
  status: 'OPEN',
};

describe('getHpdComplaints', () => {
  it('happy path: returns HPD complaints', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([MOCK]), { status: 200 }),
    );
    const rows = await getHpdComplaints(BBL);
    expect(rows[0]?.complaintid).toBe('C1');
    expect(rows[0]?.apartment).toBe('2L');
  });

  it('empty result: returns []', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await getHpdComplaints(BBL)).toEqual([]);
  });

  it('cache hit: no fetch call', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue([MOCK]);
    const spy = vi.spyOn(global, 'fetch');
    await getHpdComplaints(BBL);
    expect(spy).not.toHaveBeenCalled();
  });
});
