// Ambiguous-address picker — shown when the backend returns kind='ambiguous'.
// Renders the API's `matches` array and lets the user pick which BBL to use.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Match = { bbl: string; address: string; borough: string };

export function Ambiguous({
  matches,
  onBack,
}: {
  matches: Match[];
  onBack: () => void;
}) {
  const router = useRouter();
  const [sel, setSel] = useState<string>(matches[0]?.bbl ?? '');

  if (matches.length === 0) {
    return (
      <div className="center-card screen-fade">
        <div className="card">
          <h2>No matches found</h2>
          <p>We couldn&apos;t find any buildings matching that address.</p>
          <button className="btn ghost full" onClick={onBack} type="button">
            ← Back to search
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="center-card screen-fade">
      <div className="card" style={{ textAlign: 'left' }}>
        <h2 style={{ textAlign: 'center' }}>Pick the right address</h2>
        <p style={{ textAlign: 'center' }}>
          Your input matched <b>{matches.length} buildings</b>. Tell us which
          one you mean.
        </p>
        <div className="picker">
          {matches.map((o) => (
            <button
              key={o.bbl}
              type="button"
              className={`opt ${sel === o.bbl ? 'sel' : ''}`}
              onClick={() => setSel(o.bbl)}
            >
              <div className="radio" />
              <div className="info">
                <b>{o.address}</b>
                <span>
                  {o.borough} · BBL {o.bbl}
                </span>
              </div>
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn ghost" onClick={onBack} type="button">
            ← Back
          </button>
          <button
            className="btn primary full"
            type="button"
            onClick={() => router.push(`/building/${sel}?fresh=1`)}
            disabled={!sel}
          >
            Generate report →
          </button>
        </div>
      </div>
    </div>
  );
}
