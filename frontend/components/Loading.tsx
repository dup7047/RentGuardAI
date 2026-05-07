// 6-step animated loading interstitial. Shown by LookupForm while the
// /v1/lookup POST is in flight. The steps are visual only — the actual
// lookup is a single fetch. When the timer reaches the last step it
// HOLDS there (with the progress bar at 100% and a spinning icon) until
// the parent unmounts the component, since the backend can take 30s on
// cold start, longer than the timer's natural ~4s pass.

'use client';

import { useEffect, useState } from 'react';

import { Mark } from './Mark';

const STEPS = [
  { k: 'parse', label: 'Parsing your input' },
  { k: 'geo', label: 'Resolving address to BBL' },
  { k: 'hpd', label: 'Pulling HPD violations & registrations' },
  { k: 'dob', label: 'Pulling DOB complaints, evictions, 311' },
  { k: 'owner', label: 'Looking up owner & watchlist match' },
  { k: 'ai', label: 'Synthesizing AI summary' },
] as const;

export function Loading() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (idx >= STEPS.length) return; // hold on the last step
    const delay = idx === 0 ? 380 : 600 + Math.random() * 250;
    const t = setTimeout(() => setIdx((i) => i + 1), delay);
    return () => clearTimeout(t);
  }, [idx]);

  // While idx < STEPS.length, the active step is `idx`.
  // Once idx === STEPS.length, all are done EXCEPT we visually pin the last
  // step as still active so the user sees "AI summary in progress".
  const overrun = idx >= STEPS.length;
  const activeIdx = overrun ? STEPS.length - 1 : idx;
  const pct = overrun ? 100 : Math.min(100, (idx / STEPS.length) * 100);

  return (
    <div className="loading-wrap screen-fade">
      <div className="loading-card">
        <div className="header">
          <div style={{ width: 40, height: 40, display: 'grid', placeItems: 'center' }}>
            <Mark size={36} />
          </div>
          <div>
            <h3>Reading the listing & public records…</h3>
            <span>This usually takes a few seconds. Don&apos;t close this tab.</span>
          </div>
        </div>

        <div className="progress-track">
          <div className="progress-bar" style={{ width: `${pct}%` }} />
        </div>

        <div className="step-list" role="status" aria-live="polite">
          {STEPS.map((s, i) => {
            const done = !overrun && i < idx;
            const active = i === activeIdx && !done;
            return (
              <div
                key={s.k}
                className={`step ${done ? 'done' : ''} ${active ? 'active' : ''}`}
              >
                <div className="ico" aria-hidden="true">
                  {done ? '✓' : active ? '' : i + 1}
                </div>
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
