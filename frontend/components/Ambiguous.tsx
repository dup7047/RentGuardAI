// Ambiguous-address picker — shown when the backend returns kind='ambiguous'.
// Renders the API's `matches` array and lets the user pick which BBL to use.
//
// On pick we delegate back to LookupForm via `onPick` so it can re-submit
// through /v1/lookup with the canonical (borough-qualified) address. This
// disambiguates server-side AND seeds the buildings table + runs the full
// scoring/AI pipeline. Navigating directly to /building/[bbl] would 404
// because the SEO archive route requires the building to already exist.

'use client';

import { useState } from 'react';

export type AmbiguousMatch = { bbl: string; address: string; borough: string };

export function Ambiguous({
  matches,
  onPick,
  onBack,
}: {
  matches: AmbiguousMatch[];
  onPick: (match: AmbiguousMatch) => void;
  onBack: () => void;
}) {
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
            onClick={() => {
              const match = matches.find((m) => m.bbl === sel);
              if (match) onPick(match);
            }}
            disabled={!sel}
          >
            Generate report →
          </button>
        </div>
      </div>
    </div>
  );
}
