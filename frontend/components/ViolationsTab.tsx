'use client';

import type { LookupResponse } from '@/lib/api/backend';
import { hpdViolationsUrl } from '@/lib/sources/urls';

type SuccessData = Extract<LookupResponse, { kind: 'success' }>;

function classTone(cls?: string): 'good' | 'warn' | 'bad' {
  if (cls === 'C' || cls === 'I') return 'bad';
  if (cls === 'B') return 'warn';
  return 'good';
}

function fmtDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

export function ViolationsTab({ data }: { data: SuccessData }) {
  const rows = data.violations_rows ?? [];
  const totalCount = data.total_counts?.violations ?? rows.length;
  const hasMore = data.has_more?.violations ?? false;
  const sourceUrl = hpdViolationsUrl({ hpdBuildingId: data.hpd_building_id, bbl: data.bbl });

  if (rows.length === 0) {
    return (
      <div className="card panel">
        <h3>HPD violations</h3>
        <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          No HPD violations on file for this building. You can verify directly on{' '}
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
            HPD Online ↗
          </a>
          .
        </p>
      </div>
    );
  }

  return (
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
        <h3 style={{ margin: 0 }}>HPD violations</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          Showing {rows.length.toLocaleString()} of {totalCount.toLocaleString()}
          {hasMore && ' — view all on HPD Online'}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <th style={{ padding: '8px 8px 8px 0', fontWeight: 500 }}>Class</th>
              <th style={{ padding: '8px 8px', fontWeight: 500 }}>Status</th>
              <th style={{ padding: '8px 8px', fontWeight: 500 }}>Issued</th>
              <th style={{ padding: '8px 8px', fontWeight: 500 }}>Apt.</th>
              <th style={{ padding: '8px 0 8px 8px', fontWeight: 500 }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => {
              const tone = classTone(v.class);
              return (
                <tr key={v.violationid} style={{ borderTop: '1px solid var(--line)' }}>
                  <td style={{ padding: '10px 8px 10px 0' }}>
                    <span className={`pill ${tone}`}>{v.class || '—'}</span>
                  </td>
                  <td style={{ padding: '10px 8px', color: 'var(--ink-2)' }}>{v.currentstatus || '—'}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--ink-2)' }}>{fmtDate(v.novissueddate || v.inspectiondate)}</td>
                  <td style={{ padding: '10px 8px', color: 'var(--ink-2)' }}>{v.apartment || '—'}</td>
                  <td style={{ padding: '10px 0 10px 8px', color: 'var(--ink)', maxWidth: 480 }}>
                    {v.novdescription
                      ? v.novdescription.length > 200
                        ? `${v.novdescription.slice(0, 200)}…`
                        : v.novdescription
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 16 }}>
        <a className="btn ghost sm" href={sourceUrl} target="_blank" rel="noopener noreferrer">
          View all on HPD Online ↗
        </a>
      </div>
    </div>
  );
}
