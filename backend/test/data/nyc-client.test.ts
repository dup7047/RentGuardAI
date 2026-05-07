import { describe, it, expect, vi, afterEach } from 'vitest';
import { socrataQuery, SocrataError } from '../../src/data/nyc-client.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function makeFetch(rows: unknown[], status = 200): typeof fetch {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(rows), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
}

describe('socrataQuery', () => {
  it('returns parsed rows on success', async () => {
    const spy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify([{ violationid: '1' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const rows = await socrataQuery<{ violationid: string }>('wvxf-dwi5', { $limit: '1' });
    expect(rows).toEqual([{ violationid: '1' }]);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('retries once on 429 then succeeds', async () => {
    let calls = 0;
    vi.spyOn(global, 'fetch').mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return new Response('rate limited', { status: 429 });
      }
      return new Response(JSON.stringify([{ violationid: '2' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const rows = await socrataQuery<{ violationid: string }>('wvxf-dwi5', { $limit: '1' });
    expect(rows).toEqual([{ violationid: '2' }]);
    expect(calls).toBe(2);
  });

  it('throws SocrataError after two 429s', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
    await expect(socrataQuery('wvxf-dwi5', { $limit: '1' })).rejects.toBeInstanceOf(SocrataError);
  });

  it('includes X-App-Token when env var is set', async () => {
    vi.stubEnv('NYC_OPEN_DATA_APP_TOKEN', 'test-token-abc');
    let capturedHeaders: Record<string, string> = {};
    vi.spyOn(global, 'fetch').mockImplementation(async (_url, init) => {
      capturedHeaders = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response(JSON.stringify([{ x: 1 }]), { status: 200 });
    });
    await socrataQuery('wvxf-dwi5', { $limit: '1' });
    expect(capturedHeaders['x-app-token']).toBe('test-token-abc');
  });

  it('throws SocrataError on non-200 status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('server error', { status: 500 }));
    await expect(socrataQuery('wvxf-dwi5', { $limit: '1' })).rejects.toBeInstanceOf(SocrataError);
  });

  it('throws SocrataError on network failure', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(socrataQuery('wvxf-dwi5', { $limit: '1' })).rejects.toBeInstanceOf(SocrataError);
  });
});
