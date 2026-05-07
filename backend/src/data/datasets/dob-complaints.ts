// DOB Complaints Received — filtered by bin (Building Identification Number).
// BBL→BIN mapping comes from HPD registrations. Falls back to empty array if no BIN.

import { socrataQuery } from '../nyc-client.js';
import { getCached, readCachedSlice, setCached } from '../cache.js';
import type { CachedData } from '../types.js';
import { ENDPOINTS } from '../endpoints.js';

export type DobComplaint = {
  complaint_number: string;
  bin?: string;
  house_number?: string;
  house_street?: string;
  zip_code?: string;
  community_board?: string;
  complaint_category?: string;
  date_entered?: string;
  disposition_code?: string;
  disposition_date?: string;
  inspection_date?: string;
  status?: string;
};

const EP = ENDPOINTS.find((e) => e.key === 'dob_complaints')!;

/**
 * Fetch DOB complaints for a building.
 * @param bbl  10-digit BBL (used as cache key)
 * @param bin  7-digit Building Identification Number (used for Socrata filter)
 */
export async function getDobComplaints(
  bbl: string,
  bin?: string,
  prefetched?: CachedData | null,
): Promise<DobComplaint[]> {
  const cached =
    prefetched !== undefined
      ? readCachedSlice(prefetched, 'dob_complaints')
      : await getCached(bbl, 'dob_complaints');
  if (cached) return cached as DobComplaint[];

  // DOB complaints are indexed by BIN, not BBL. Return empty if no BIN.
  if (!bin) {
    await setCached(bbl, 'dob_complaints', []);
    return [];
  }

  const rows = await socrataQuery<DobComplaint>(EP.resourceId, {
    $where: `bin='${bin}'`,
    $limit: '500',
    $order: 'date_entered DESC',
  });

  await setCached(bbl, 'dob_complaints', rows);
  return rows;
}
