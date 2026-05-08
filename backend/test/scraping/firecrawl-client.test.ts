import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  firecrawlFetch,
  isFirecrawlAvailable,
  FirecrawlError,
  __resetFirecrawlQuotaFlag,
} from '../../src/scraping/firecrawl-client.js';

// Quiet the logger.warn the client emits on error responses
vi.mock('../../src/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(() => {
  process.env.FIRECRAWL_API_KEY = 'fc-test-key';
  __resetFirecrawlQuotaFlag();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.FIRECRAWL_API_KEY;
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('firecrawlFetch — happy path', () => {
  it('maps a 200 response to FirecrawlResult', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: {
          rawHtml: '<html><body>Hello</body></html>',
          metadata: {
            sourceURL: 'https://example.com/final',
            statusCode: 200,
            creditsUsed: 3,
          },
        },
      }),
    );
    const r = await firecrawlFetch('https://example.com');
    expect(r.html).toBe('<html><body>Hello</body></html>');
    expect(r.finalUrl).toBe('https://example.com/final');
    expect(r.statusCode).toBe(200);
    expect(r.costCredits).toBe(3);
  });

  it('falls back to input URL when metadata.sourceURL is missing', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: { rawHtml: '<html></html>', metadata: { statusCode: 200 } },
      }),
    );
    const r = await firecrawlFetch('https://example.com/orig');
    expect(r.finalUrl).toBe('https://example.com/orig');
    expect(r.costCredits).toBe(0);
  });
});

describe('firecrawlFetch — error mapping', () => {
  it('throws no_api_key when FIRECRAWL_API_KEY is missing', async () => {
    delete process.env.FIRECRAWL_API_KEY;
    await expect(firecrawlFetch('https://example.com')).rejects.toMatchObject({
      name: 'FirecrawlError',
      code: 'no_api_key',
    });
  });

  it('maps HTTP 401 to no_api_key (bad/revoked key)', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(401, { success: false, error: 'Invalid API key' }),
    );
    await expect(firecrawlFetch('https://example.com')).rejects.toMatchObject({
      code: 'no_api_key',
      status: 401,
    });
  });

  it('maps HTTP 402 to quota_exceeded AND flips the in-process flag', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(402, { success: false, error: 'Insufficient credits' }),
    );
    await expect(firecrawlFetch('https://example.com')).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    // Subsequent availability check returns false even though the env var is set
    expect(isFirecrawlAvailable()).toBe(false);
  });

  it('maps an "insufficient credits" error message to quota_exceeded even on a non-402 status', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(400, { success: false, error: 'Out of credits — please upgrade' }),
    );
    await expect(firecrawlFetch('https://example.com')).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
  });

  it('maps HTTP 408 / "timeout" error message to timeout code', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(408, { success: false, error: 'Request timeout exceeded' }),
    );
    await expect(firecrawlFetch('https://example.com')).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('maps HTTP 500 to http_error', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(500, { success: false, error: 'Internal server error' }),
    );
    await expect(firecrawlFetch('https://example.com')).rejects.toMatchObject({
      code: 'http_error',
      status: 500,
    });
  });

  it('throws http_error when success:true but rawHtml is empty/missing', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, { success: true, data: { rawHtml: '' } }),
    );
    await expect(firecrawlFetch('https://example.com')).rejects.toMatchObject({
      code: 'http_error',
    });
  });

  it('translates AbortError to timeout', async () => {
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    });
    await expect(firecrawlFetch('https://example.com')).rejects.toMatchObject({
      code: 'timeout',
    });
  });
});

describe('isFirecrawlAvailable', () => {
  it('returns true when env var is set and quota flag is clear', () => {
    expect(isFirecrawlAvailable()).toBe(true);
  });

  it('returns false when env var is missing', () => {
    delete process.env.FIRECRAWL_API_KEY;
    expect(isFirecrawlAvailable()).toBe(false);
  });

  it('stays false until restart after quota_exceeded', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(402, { success: false, error: 'Insufficient credits' }),
    );
    await expect(firecrawlFetch('https://example.com')).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
    expect(isFirecrawlAvailable()).toBe(false);
    // Even with key still set, flag persists — only __resetFirecrawlQuotaFlag clears it
    process.env.FIRECRAWL_API_KEY = 'fc-still-set';
    expect(isFirecrawlAvailable()).toBe(false);
  });
});

describe('FirecrawlError', () => {
  it('exposes status and code on the error instance', () => {
    const err = new FirecrawlError('boom', 402, 'quota_exceeded');
    expect(err.message).toBe('boom');
    expect(err.status).toBe(402);
    expect(err.code).toBe('quota_exceeded');
    expect(err instanceof Error).toBe(true);
    expect(err instanceof FirecrawlError).toBe(true);
  });
});
