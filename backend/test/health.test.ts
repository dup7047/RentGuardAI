import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app.js';
import { REQUEST_ID_HEADER } from '../src/middleware/request-logger.js';

describe('GET /health', () => {
  it('returns 200 with status ok and a commit string', async () => {
    const app = createApp();
    const res = await app.request('/health');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; commit: string };
    expect(body.status).toBe('ok');
    expect(typeof body.commit).toBe('string');
    expect(body.commit.length).toBeGreaterThan(0);
  });

  it('attaches a request id header to the response', async () => {
    const app = createApp();
    const res = await app.request('/health');

    const requestId = res.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toBeTruthy();
    expect(requestId?.length ?? 0).toBeGreaterThan(0);
  });

  it('echoes a caller-provided request id', async () => {
    const app = createApp();
    const res = await app.request('/health', {
      headers: { [REQUEST_ID_HEADER]: 'test-request-id-123' },
    });

    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('test-request-id-123');
  });
});
