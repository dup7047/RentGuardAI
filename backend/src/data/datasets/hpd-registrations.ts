import { socrataQuery } from '../nyc-client.js';
import { getCached, setCached } from '../cache.js';
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

export async function getHpdRegistrations(bbl: string): Promise<HpdRegistration[]> {
  const cached = await getCached(bbl, 'hpd_registrations');
  if (cached) return cached as HpdRegistration[];

  const rows = await socrataQuery<HpdRegistration>(EP.resourceId, {
    $where: `bbl='${bbl}'`,
    $limit: '10',
    $order: 'lastregistrationdate DESC',
  });

  await setCached(bbl, 'hpd_registrations', rows);
  return rows;
}
