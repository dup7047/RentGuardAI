// HPD Registration Contacts — queried by registrationid, not BBL.
// Use getHpdRegistrations() first to obtain a registrationid.

import { socrataQuery } from '../nyc-client.js';
import { ENDPOINTS } from '../endpoints.js';

export type HpdContact = {
  registrationcontactid: string;
  registrationid: string;
  type?: string;
  contactdescription?: string;
  corporationname?: string;
  firstname?: string;
  middleinitial?: string;
  lastname?: string;
  title?: string;
  businesshousenumber?: string;
  businessstreetname?: string;
  businessapartment?: string;
  businesscity?: string;
  businessstate?: string;
  businesszip?: string;
};

const EP = ENDPOINTS.find((e) => e.key === 'hpd_contacts')!;

/** Fetch contacts for a given HPD registration ID (not BBL). */
export async function getHpdContacts(registrationId: string): Promise<HpdContact[]> {
  // Contacts are not cached per-BBL because they're keyed by registrationid.
  // The landlord lookup (Phase 3.4) calls this after fetching a registrationid
  // and caches the result at the landlord level.
  return socrataQuery<HpdContact>(EP.resourceId, {
    $where: `registrationid='${registrationId}'`,
    $limit: '50',
  });
}
