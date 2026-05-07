// Low-level Socrata SODA 2.1 fetcher.
// Wraps NYC Open Data HTTP calls with: X-App-Token injection, 10s timeout,
// one retry on 429, structured logging.

import { logger } from '../logger.js';

export class SocrataError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SocrataError';
  }
}

/**
 * Fetch rows from a Socrata SODA endpoint.
 * @param resourceId  4×4 Socrata resource ID, e.g. "wvxf-dwi5"
 * @param params      SoQL query parameters ($where, $limit, $select, etc.)
 * @returns           Parsed JSON array of rows as T[]
 */
export async function socrataQuery<T>(
  resourceId: string,
  params: Record<string, string>,
): Promise<T[]> {
  const url = new URL(`https://data.cityofnewyork.us/resource/${resourceId}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.NYC_OPEN_DATA_APP_TOKEN) {
    headers['X-App-Token'] = process.env.NYC_OPEN_DATA_APP_TOKEN;
  }

  const start = Date.now();
  let lastError: unknown;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(url.toString(), { headers, signal: ctrl.signal });
      clearTimeout(timer);
      const ms = Date.now() - start;

      if (res.status === 429 && attempt === 1) {
        logger.warn({ resourceId, attempt }, 'Socrata 429 — waiting 2s before retry');
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new SocrataError(
          `Socrata ${resourceId} → HTTP ${res.status}: ${body.slice(0, 200)}`,
          res.status,
        );
      }

      const data = (await res.json()) as T[];
      logger.info({
        resourceId,
        status: res.status,
        durationMs: ms,
        recordCount: data.length,
      });
      return data;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (attempt === 2 || e instanceof SocrataError) {
        break;
      }
    }
  }

  if (lastError instanceof SocrataError) throw lastError;
  throw new SocrataError(String(lastError));
}
