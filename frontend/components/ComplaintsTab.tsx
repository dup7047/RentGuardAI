'use client';

import type { LookupResponse } from '@/lib/api/backend';
import { dobComplaintsUrl, threeOneOneUrl } from '@/lib/sources/urls';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export function ComplaintsTab({ data }: { data: SuccessData }) {
  const dob = data.complaints_rows?.dob ?? [];
  const threeoneone = data.complaints_rows?.threeoneone ?? [];
  const dobTotal = data.total_counts?.dob ?? dob.length;
  const threeoneoneTotal = data.total_counts?.threeoneone ?? threeoneone.length;
  const dobUrl = dobComplaintsUrl({ bin: data.bin });
  const threeoneoneSource = threeOneOneUrl({ bbl: data.bbl });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="card panel">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>DOB complaints</h3>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {dob.length === 0
              ? 'No complaints on file.'
              : `Showing ${dob.length.toLocaleString()} of ${dobTotal.toLocaleString()}`}
          </div>
        </div>

        {dob.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '8px 8px 8px 0', fontWeight: 500 }}>Date</th>
                  <th style={{ padding: '8px 8px', fontWeight: 500 }}>Category</th>
                  <th style={{ padding: '8px 8px', fontWeight: 500 }}>Status</th>
                  <th style={{ padding: '8px 0 8px 8px', fontWeight: 500 }}>Disposition</th>
                </tr>
              </thead>
              <tbody>
                {dob.map((d) => (
                  <tr key={d.complaint_number} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 8px 10px 0', color: 'var(--ink-2)' }}>{fmtDate(d.date_entered)}</td>
                    <td style={{ padding: '10px 8px' }}>{d.complaint_category || '—'}</td>
                    <td style={{ padding: '10px 8px', color: 'var(--ink-2)' }}>{d.status || '—'}</td>
                    <td style={{ padding: '10px 0 10px 8px', color: 'var(--ink-2)' }}>
                      {d.disposition_code ? `${d.disposition_code} (${fmtDate(d.disposition_date)})` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <a className="btn ghost sm" href={dobUrl} target="_blank" rel="noopener noreferrer">
            View on DOB BIS ↗
          </a>
        </div>
      </div>

      <div className="card panel">
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>311 housing complaints</h3>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {threeoneone.length === 0
              ? 'No 311 calls on file.'
              : `Showing ${threeoneone.length.toLocaleString()} of ${threeoneoneTotal.toLocaleString()}`}
          </div>
        </div>

        {threeoneone.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <th style={{ padding: '8px 8px 8px 0', fontWeight: 500 }}>Date</th>
                  <th style={{ padding: '8px 8px', fontWeight: 500 }}>Agency</th>
                  <th style={{ padding: '8px 8px', fontWeight: 500 }}>Type</th>
                  <th style={{ padding: '8px 8px', fontWeight: 500 }}>Descriptor</th>
                  <th style={{ padding: '8px 0 8px 8px', fontWeight: 500 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {threeoneone.map((t) => (
                  <tr key={t.unique_key} style={{ borderTop: '1px solid var(--line)' }}>
                    <td style={{ padding: '10px 8px 10px 0', color: 'var(--ink-2)' }}>{fmtDate(t.created_date)}</td>
                    <td style={{ padding: '10px 8px' }}>{t.agency || '—'}</td>
                    <td style={{ padding: '10px 8px' }}>{t.complaint_type || '—'}</td>
                    <td style={{ padding: '10px 8px', color: 'var(--ink-2)' }}>{t.descriptor || '—'}</td>
                    <td style={{ padding: '10px 0 10px 8px', color: 'var(--ink-2)' }}>{t.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <a className="btn ghost sm" href={threeoneoneSource} target="_blank" rel="noopener noreferrer">
            View on NYC Open Data ↗
          </a>
        </div>
      </div>
    </div>
  );
}
