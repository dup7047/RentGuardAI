import { socrataQuery } from '../nyc-client.js';
import { getCached, setCached } from '../cache.js';
import { ENDPOINTS } from '../endpoints.js';

export type HpdComplaint = {
  complaintid: string;
  bbl?: string;
  bin?: string;
  buildingid?: string;
  apartment?: string;
  receiveddate?: string;
  status?: string;
  statusid?: string;
  statusdate?: string;
  housenumber?: string;
  housestreet?: string;
  zip?: string;
  borough?: string;
  boroughid?: string;
};

const EP = ENDPOINTS.find((e) => e.key === 'hpd_complaints')!;

export async function getHpdComplaints(bbl: string): Promise<HpdComplaint[]> {
  const cached = await getCached(bbl, 'hpd_complaints');
  if (cached) return cached as HpdComplaint[];

  const rows = await socrataQuery<HpdComplaint>(EP.resourceId, {
    $where: `bbl='${bbl}'`,
    $limit: '500',
    $order: 'receiveddate DESC',
    $select:
      'complaintid,bbl,bin,buildingid,apartment,receiveddate,status,statusid,statusdate,housenumber,housestreet,zip',
  });

  await setCached(bbl, 'hpd_complaints', rows);
  return rows;
}
