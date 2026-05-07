import { socrataQuery } from '../nyc-client.js';
import { getCached, setCached } from '../cache.js';
import { ENDPOINTS } from '../endpoints.js';

export type ServiceRequest311 = {
  unique_key: string;
  created_date?: string;
  agency?: string;
  complaint_type?: string;
  descriptor?: string;
  incident_address?: string;
  street_name?: string;
  incident_zip?: string;
  borough?: string;
  bbl?: string;
  status?: string;
  resolution_description?: string;
  resolution_action_updated_date?: string;
  latitude?: string;
  longitude?: string;
};

const EP = ENDPOINTS.find((e) => e.key === 'three11_housing')!;

export async function get311HousingRequests(bbl: string): Promise<ServiceRequest311[]> {
  const cached = await getCached(bbl, 'three11_housing');
  if (cached) return cached as ServiceRequest311[];

  const rows = await socrataQuery<ServiceRequest311>(EP.resourceId, {
    $where: `bbl='${bbl}' AND agency IN('HPD','DOB','DEP','DOHMH')`,
    $limit: '500',
    $order: 'created_date DESC',
    $select: 'unique_key,created_date,agency,complaint_type,descriptor,bbl,incident_zip,status,borough',
  });

  await setCached(bbl, 'three11_housing', rows);
  return rows;
}
