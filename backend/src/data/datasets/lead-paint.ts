import { socrataQuery } from '../nyc-client.js';
import { getCached, readCachedSlice, setCached } from '../cache.js';
import type { CachedData } from '../types.js';
import { ENDPOINTS } from '../endpoints.js';

export type LeadPaintViolation = {
  violationid: string;
  buildingid?: string;
  bbl?: string;
  bin?: string;
  housenumber?: string;
  streetname?: string;
  boro?: string;
  zip?: string;
  apartment?: string;
  class?: string;
  inspectiondate?: string;
  currentstatus?: string;
  currentstatusdate?: string;
  novdescription?: string;
  originalcertifybydate?: string;
  newcertifybydate?: string;
};

const EP = ENDPOINTS.find((e) => e.key === 'lead_paint')!;

export async function getLeadPaintViolations(
  bbl: string,
  prefetched?: CachedData | null,
): Promise<LeadPaintViolation[]> {
  const cached =
    prefetched !== undefined
      ? readCachedSlice(prefetched, 'lead_paint')
      : await getCached(bbl, 'lead_paint');
  if (cached) return cached as LeadPaintViolation[];

  const rows = await socrataQuery<LeadPaintViolation>(EP.resourceId, {
    $where: `bbl='${bbl}'`,
    $limit: '200',
    $order: 'inspectiondate DESC',
  });

  await setCached(bbl, 'lead_paint', rows);
  return rows;
}
