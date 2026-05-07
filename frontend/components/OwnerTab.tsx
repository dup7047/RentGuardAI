'use client';

import type { LookupResponse } from '@/lib/api/backend';
import { hpdRegistrationsUrl, watchlistUrl } from '@/lib/sources/urls';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;

function field(label: string, value: string | null | undefined) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 16,
        padding: '10px 0',
        borderTop: '1px solid var(--line)',
        fontSize: 13.5,
      }}
    >
      <div style={{ color: 'var(--muted)', flex: '0 0 200px', textTransform: 'uppercase', fontSize: 11, letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ color: 'var(--ink)', flex: 1 }}>{value || '—'}</div>
    </div>
  );
}

export function OwnerTab({ data }: { data: SuccessData }) {
  const l = data.landlord || {};
  const registered = (l.registered_owner_name as string | null | undefined) ?? null;
  const corporation = (l.hpd_corporation_name as string | null | undefined) ?? null;
  const headOfficer = (l.head_officer_name as string | null | undefined) ?? null;
  const businessAddress =
    (l.head_officer_business_address as string | null | undefined) ?? null;
  const watchlistRank = (l.watchlist_rank as number | null | undefined) ?? null;
  const lastFetched = (l.last_fetched_at as string | null | undefined) ?? null;

  return (
    <div className="card panel">
      <h3>Registered owner & watchlist</h3>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: -6, marginBottom: 14, lineHeight: 1.6 }}>
        Names and contact information are taken verbatim from the most recent HPD Multiple Dwelling Registration filing for this building.
      </p>

      <div style={{ borderBottom: '1px solid var(--line)' }}>
        {field('Registered owner', registered)}
        {field('HPD corporation name', corporation)}
        {field('Head officer', headOfficer)}
        {field('Head officer business address', businessAddress)}
        {field(
          'Worst Landlord Watchlist rank',
          watchlistRank !== null ? `#${watchlistRank}` : 'Not on the current list',
        )}
        {field(
          'Last refreshed from HPD',
          lastFetched ? new Date(lastFetched).toLocaleDateString() : null,
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
        <a
          className="btn ghost sm"
          href={hpdRegistrationsUrl({ bbl: data.bbl })}
          target="_blank"
          rel="noopener noreferrer"
        >
          View registration on NYC Open Data ↗
        </a>
        <a
          className="btn ghost sm"
          href={watchlistUrl({ registeredOwnerName: registered, watchlistRank })}
          target="_blank"
          rel="noopener noreferrer"
        >
          View on Worst Landlord Watchlist ↗
        </a>
      </div>
    </div>
  );
}
