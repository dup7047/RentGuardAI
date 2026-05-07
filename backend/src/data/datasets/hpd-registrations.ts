import { socrataQuery } from '../nyc-client.js';
import { getCached, readCachedSlice, setCached } from '../cache.js';
import type { CachedData } from '../types.js';
import { ENDPOINTS } from '../endpoints.js';

export type HpdRegistration = {
  registrationid: string;
  buildingid?: string;
  bbl?: string;
  bin?: string;
  housenumber?: string;
  streetname?: string;
  boroid?: string;
  boro?: string;
  zip?: string;
  block?: string;
  lot?: string;
  corporationname?: string;
  lastregistrationdate?: string;
  registrationenddate?: string;
};

const EP = ENDPOINTS.find((e) => e.key === 'hpd_registrations')!;

/**
 * Parse a 10-digit BBL into its component parts for HPD-Registrations queries.
 * The dataset doesn't expose `bbl` as a queryable column (HTTP 400 if used);
 * it stores boroid/block/lot as separate columns with no leading zeros.
 *
 * BBL format: <1 borough digit><5 block digits><4 lot digits>
 * e.g. 1008350041 → { boroid: '1', block: '835', lot: '41' }
 */
export function decomposeBbl(bbl: string): { boroid: string; block: string; lot: string } | null {
  if (!/^\d{10}$/.test(bbl)) return null;
  return {
    boroid: bbl.slice(0, 1),
    block: String(parseInt(bbl.slice(1, 6), 10)),
    lot: String(parseInt(bbl.slice(6, 10), 10)),
  };
}

export async function getHpdRegistrations(
  bbl: string,
  prefetched?: CachedData | null,
): Promise<HpdRegistration[]> {
  const cached =
    prefetched !== undefined
      ? readCachedSlice(prefetched, 'hpd_registrations')
      : await getCached(bbl, 'hpd_registrations');
  if (cached) return cached as HpdRegistration[];

  const parts = decomposeBbl(bbl);
  if (!parts) {
    await setCached(bbl, 'hpd_registrations', []);
    return [];
  }

  const rows = await socrataQuery<HpdRegistration>(EP.resourceId, {
    $where: `boroid='${parts.boroid}' AND block='${parts.block}' AND lot='${parts.lot}'`,
    $limit: '10',
    $order: 'lastregistrationdate DESC',
  });

  await setCached(bbl, 'hpd_registrations', rows);
  return rows;
}
