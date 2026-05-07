// HPD Registered Owner lookup with 7-day cache.
// Fetches registration + contacts from NYC Open Data and caches the result
// in the landlords table, linking it back to buildings via FK.

import { getDb, getPool } from '../db/client.js';
import { buildings, landlords } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getHpdRegistrations } from './datasets/hpd-registrations.js';
import { getHpdContacts } from './datasets/hpd-contacts.js';

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type LandlordRecord = {
  registered_owner_name: string | null;
  hpd_corporation_name: string | null;
  registration_id: string | null;
  head_officer_name: string | null;
  head_officer_business_address: string | null;
  watchlist_rank: number | null;
  last_fetched_at: string;
};

const NULL_RECORD: Omit<LandlordRecord, 'last_fetched_at'> = {
  registered_owner_name: null,
  hpd_corporation_name: null,
  registration_id: null,
  head_officer_name: null,
  head_officer_business_address: null,
  watchlist_rank: null,
};

/**
 * Look up the registered owner for a building BBL.
 * Returns a cached LandlordRecord if fresh, otherwise fetches from HPD Open Data
 * and upserts into the landlords table.
 */
export async function lookupLandlord(bbl: string): Promise<LandlordRecord> {
  const db = getDb();

  // 1. Check cache via buildings.registered_owner_landlord_id
  const [b] = await db
    .select({ registeredOwnerLandlordId: buildings.registeredOwnerLandlordId })
    .from(buildings)
    .where(eq(buildings.bbl, bbl))
    .limit(1);

  if (b?.registeredOwnerLandlordId) {
    const [ll] = await db
      .select()
      .from(landlords)
      .where(eq(landlords.id, b.registeredOwnerLandlordId))
      .limit(1);

    if (ll?.lastFetchedAt && Date.now() - ll.lastFetchedAt.getTime() < STALE_AFTER_MS) {
      return {
        registered_owner_name: ll.registeredOwnerName ?? null,
        hpd_corporation_name: ll.hpdCorporationName ?? null,
        registration_id: null,
        head_officer_name: null,
        head_officer_business_address: null,
        watchlist_rank: ll.watchlistRank ?? null,
        last_fetched_at: ll.lastFetchedAt.toISOString(),
      };
    }
  }

  // 2. Live fetch from HPD Open Data
  const regs = await getHpdRegistrations(bbl);
  if (regs.length === 0) {
    return { ...NULL_RECORD, last_fetched_at: new Date().toISOString() };
  }

  const reg = regs[0]!;
  const contacts = reg.registrationid ? await getHpdContacts(reg.registrationid) : [];
  const headOfficer = contacts.find((c) => c.type === 'HeadOfficer') ?? contacts[0] ?? null;

  // 3. Upsert into landlords (conflict on normalized owner name via raw query)
  const ownerName = reg.corporationname ?? null;
  const pool = getPool();
  const upsertRes = await pool.query<{ id: string; registered_owner_name: string | null; hpd_corporation_name: string | null; watchlist_rank: number | null; last_fetched_at: string }>(
    `INSERT INTO landlords (registered_owner_name, hpd_corporation_name, last_fetched_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (lower(registered_owner_name)) WHERE registered_owner_name IS NOT NULL
     DO UPDATE SET last_fetched_at = NOW()
     RETURNING id, registered_owner_name, hpd_corporation_name, watchlist_rank, last_fetched_at`,
    [ownerName ?? 'UNKNOWN', ownerName],
  );
  const ll = upsertRes.rows[0];

  if (!ll) {
    return { ...NULL_RECORD, last_fetched_at: new Date().toISOString() };
  }

  // 4. Wire FK on buildings row (best-effort; building may not exist yet)
  await db
    .update(buildings)
    .set({ registeredOwnerLandlordId: ll.id })
    .where(eq(buildings.bbl, bbl));

  const buildAddress = (c: NonNullable<typeof headOfficer>): string =>
    [
      `${c.businesshousenumber ?? ''} ${c.businessstreetname ?? ''}`.trim(),
      c.businesscity ?? '',
      `${c.businessstate ?? ''} ${c.businesszip ?? ''}`.trim(),
    ]
      .filter(Boolean)
      .join(', ');

  return {
    registered_owner_name: ll.registered_owner_name,
    hpd_corporation_name: ll.hpd_corporation_name,
    registration_id: reg.registrationid,
    head_officer_name: headOfficer
      ? `${headOfficer.firstname ?? ''} ${headOfficer.lastname ?? ''}`.trim() || null
      : null,
    head_officer_business_address: headOfficer ? buildAddress(headOfficer) || null : null,
    watchlist_rank: ll.watchlist_rank,
    last_fetched_at: ll.last_fetched_at,
  };
}
