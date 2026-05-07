import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDobComplaints } from '../../../src/data/datasets/dob-complaints.js';
import * as cache from '../../../src/data/cache.js';

afterEach(() => vi.restoreAllMocks());

const BBL = '1008440007';
const BIN = '1020000';
const MOCK = { complaint_number: 'C1', bin: BIN, status: 'ACTIVE' };

describe('getDobComplaints', () => {
  it('happy path with BIN: returns complaints', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([MOCK]), { status: 200 }),
    );
    const rows = await getDobComplaints(BBL, BIN);
    expect(rows[0]?.complaint_number).toBe('C1');
  });

  it('empty result: returns []', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue(null);
    vi.spyOn(cache, 'setCached').mockResolvedValue(undefined);
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    expect(await getDobComplaints(BBL, BIN)).toEqual([]);
  });

  it('cache hit: no fetch call', async () => {
    vi.spyOn(cache, 'getCached').mockResolvedValue([MOCK]);
    const spy = vi.spyOn(global, 'fetch');
    await getDobComplaints(BBL, BIN);
    expect(spy).not.toHaveBeenCalled();
  });
});
