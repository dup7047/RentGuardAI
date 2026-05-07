import { socrataQuery } from '../nyc-client.js';
import { getCached, setCached } from '../cache.js';
import { ENDPOINTS } from '../endpoints.js';

export type BedbugReport = {
  building_id?: string;
  bbl?: string;
  bin?: string;
  house_number?: string;
  street_name?: string;
  borough?: string;
  zip?: string;
  filing_period?: string;
  filing_date?: string;
  infested_dwelling_unit_count?: string;
  eradicated_unit_count?: string;
  re_infested_dwelling_unit_count?: string;
};

const EP = ENDPOINTS.find((e) => e.key === 'bedbug')!;

export async function getBedbugReports(bbl: string): Promise<BedbugReport[]> {
  const cached = await getCached(bbl, 'bedbug');
  if (cached) return cached as BedbugReport[];

  // Note: actual column is `filing_period_start_date` (the dataset has a typo
  // counterpart `filling_period_end_date` we don't use). `filing_period` does
  // not exist — using it returns HTTP 400.
  const rows = await socrataQuery<BedbugReport>(EP.resourceId, {
    $where: `bbl='${bbl}'`,
    $limit: '20',
    $order: 'filing_period_start_date DESC',
  });

  await setCached(bbl, 'bedbug', rows);
  return rows;
}
