// Client component for the dashboard's saved-buildings list. The parent
// page is a server component handling auth; this child handles the data
// fetch + Unsave interactivity.

'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import {
  getBandLabel,
  getReportTone,
  listSavedBuildings,
  unsaveBuilding,
  type SavedBuilding,
} from '@/lib/api/backend';

type Status = 'loading' | 'ready' | 'error';

function formatBorough(borough: string | null): string {
  if (!borough) return '';
  // The API returns boroughs uppercase (e.g. "BROOKLYN"); render in title case.
  return borough.charAt(0).toUpperCase() + borough.slice(1).toLowerCase();
}

function formatSavedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

export function SavedBuildingsList() {
  const [status, setStatus] = useState<Status>('loading');
  const [items, setItems] = useState<SavedBuilding[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listSavedBuildings();
        if (cancelled) return;
        setItems(r.items);
        setStatus('ready');
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleUnsave(bbl: string) {
    // Optimistic remove. On failure, restore + surface a small inline error.
    const prev = items;
    setItems((cur) => cur.filter((i) => i.bbl !== bbl));
    try {
      await unsaveBuilding(bbl);
    } catch {
      setItems(prev);
      setError("Couldn't unsave — try again.");
    }
  }

  if (status === 'loading') {
    return (
      <div className="card dashboard-empty">
        <p>Loading…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="card dashboard-empty">
        <h2>Couldn&apos;t load your saved buildings</h2>
        <p>{error ?? 'Try again in a moment.'}</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="card dashboard-empty">
        <div className="icn" aria-hidden="true">
          ★
        </div>
        <h2>No saved buildings yet</h2>
        <p>
          Run a lookup and tap{' '}
          <span style={{ color: 'var(--accent)', fontWeight: 600 }}>
            ★ Save building
          </span>{' '}
          on any report — it&apos;ll show up here for quick reference.
        </p>
        <Link href="/" className="btn primary" style={{ marginTop: 8 }}>
          Run your first lookup →
        </Link>
      </div>
    );
  }

  return (
    <div className="saved-list">
      {items.map((item) => {
        const tone = getReportTone(item.score_band);
        const bandLabel = getBandLabel(item.score_band);
        const borough = formatBorough(item.borough);
        return (
          <div key={item.bbl} className="saved-row">
            <Link
              href={`/building/${item.bbl}`}
              className="col"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <b>{item.address ?? `Building ${item.bbl}`}</b>
              <span>
                {borough ? `${borough} · ` : ''}Saved {formatSavedDate(item.saved_at)}
              </span>
            </Link>
            {item.score !== null && (
              <span
                className="mono"
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 999,
                  background:
                    tone === 'good'
                      ? 'color-mix(in oklch, var(--good) 14%, white)'
                      : tone === 'warn'
                        ? 'color-mix(in oklch, oklch(0.7 0.13 70) 18%, white)'
                        : 'color-mix(in oklch, var(--bad) 14%, white)',
                  color:
                    tone === 'good'
                      ? 'var(--good)'
                      : tone === 'warn'
                        ? 'oklch(0.45 0.13 70)'
                        : 'var(--bad)',
                }}
              >
                {item.score} · {bandLabel}
              </span>
            )}
            <button
              type="button"
              className="btn ghost sm"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void handleUnsave(item.bbl);
              }}
              aria-label={`Unsave ${item.address ?? item.bbl}`}
            >
              Unsave
            </button>
          </div>
        );
      })}
    </div>
  );
}
