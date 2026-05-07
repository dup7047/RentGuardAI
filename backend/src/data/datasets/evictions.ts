import { socrataQuery } from '../nyc-client.js';
import { getCached, setCached } from '../cache.js';
import { ENDPOINTS } from '../endpoints.js';

export type Eviction = {
  court_index_number: string;
  docket_number?: string;
  eviction_address?: string;
  eviction_apt_num?: string;
  executed_date?: string;
  marshal_first_name?: string;
  marshal_last_name?: string;
  residential_commercial_ind?: string;
  borough?: string;
  zip?: string;
  bbl?: string;
  bin?: string;
  eviction_legal_possession?: string;
  latitude?: string;
  longitude?: string;
};

const EP = ENDPOINTS.find((e) => e.key === 'evictions')!;

export async function getEvictions(bbl: string): Promise<Eviction[]> {
  const cached = await getCached(bbl, 'evictions');
  if (cached) return cached as Eviction[];

  const rows = await socrataQuery<Eviction>(EP.resourceId, {
    $where: `bbl='${bbl}' AND residential_commercial_ind='Residential'`,
    $limit: '200',
    $order: 'executed_date DESC',
  });

  await setCached(bbl, 'evictions', rows);
  return rows;
}
