import { socrataQuery } from '../nyc-client.js';
import { getCached, setCached } from '../cache.js';
import { ENDPOINTS } from '../endpoints.js';

export type HpdViolation = {
  violationid: string;
  bbl: string;
  buildingid?: string;
  bin?: string;
  class?: string;
  novissueddate?: string;
  inspectiondate?: string;
  currentstatus?: string;
  currentstatusdate?: string;
  novdescription?: string;
  housenumber?: string;
  streetname?: string;
  boro?: string;
  zip?: string;
  apartment?: string;
  story?: string;
  latitude?: string;
  longitude?: string;
};

const EP = ENDPOINTS.find((e) => e.key === 'hpd_violations')!;

export async function getHpdViolations(bbl: string): Promise<HpdViolation[]> {
  const cached = await getCached(bbl, 'hpd_violations');
  if (cached) return cached as HpdViolation[];

  const rows = await socrataQuery<HpdViolation>(EP.resourceId, {
    $where: `bbl='${bbl}'`,
    $limit: '1000',
    $order: 'inspectiondate DESC',
  });

  await setCached(bbl, 'hpd_violations', rows);
  return rows;
}
