'use client';

import type { LookupResponse } from '@/lib/api/backend';
import {
  dobComplaintsUrl,
  evictionsUrl,
  hpdRegistrationsUrl,
  hpdViolationsUrl,
  threeOneOneUrl,
  watchlistUrl,
} from '@/lib/sources/urls';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;

export function SourcesTab({ data }: { data: SuccessData }) {
  const registeredOwnerName = data.landlord?.registered_owner_name as
    | string
    | null
    | undefined;
  const watchlistRank = data.landlord?.watchlist_rank as
    | number
    | null
    | undefined;

  const rows: Array<{
    name: string;
    refresh: string;
    what: string;
    url: string;
  }> = [
    {
      name: 'HPD Housing Maintenance Code Violations',
      refresh: 'Daily',
      what: 'Every Class A/B/C/I violation on this building, with status and compliance deadlines.',
      url: hpdViolationsUrl({ hpdBuildingId: data.hpd_building_id, bbl: data.bbl }),
    },
    {
      name: 'HPD Multiple Dwelling Registrations',
      refresh: 'Weekly',
      what: 'The current registration filing for this building. Identifies the registered owner.',
      url: hpdRegistrationsUrl({ bbl: data.bbl }),
    },
    {
      name: 'DOB Complaints',
      refresh: 'Daily',
      what: 'Construction and safety complaints filed against the building, with disposition.',
      url: dobComplaintsUrl({ bin: data.bin }),
    },
    {
      name: '311 Housing Service Requests',
      refresh: 'Daily',
      what: 'Resident-filed 311 calls about heat, hot water, mold, vermin, and other housing conditions.',
      url: threeOneOneUrl({ bbl: data.bbl }),
    },
    {
      name: 'NYC Marshal Evictions',
      refresh: 'Daily',
      what: 'Evictions actually executed by NYC marshals. Counts only completed evictions, not filings.',
      url: evictionsUrl({ bbl: data.bbl }),
    },
    {
      name: 'Worst Landlord Watchlist',
      refresh: 'Annual / Monthly updates',
      what: 'NYC Public Advocate’s landlord watchlist. Rank shown when the registered owner matches an entry.',
      url: watchlistUrl({ registeredOwnerName, watchlistRank }),
    },
  ];

  return (
    <div className="card panel">
      <h3>Sources for this building</h3>
      <p style={{ fontSize: 13, color: 'var(--ink-2)', marginTop: -6, marginBottom: 14, lineHeight: 1.6 }}>
        Every count on this report links back to the primary source on NYC.gov. Click any source to verify the underlying records.
      </p>
      {rows.map((r) => (
        <div key={r.name} className="finding" style={{ alignItems: 'flex-start' }}>
          <div className="icn good" aria-hidden="true">
            ↗
          </div>
          <div className="body">
            <b>{r.name}</b>
            <span>{r.what}</span>
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-block', marginTop: 6, fontSize: 12.5 }}
            >
              View on source ↗
            </a>
            <span
              className="mono"
              style={{ display: 'block', marginTop: 4, fontSize: 11, color: 'var(--muted)' }}
            >
              Refresh: {r.refresh}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
