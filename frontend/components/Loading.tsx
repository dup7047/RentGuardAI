// 6-step animated loading interstitial. Shown by LookupForm while the
// /v1/lookup/stream POST is in flight.
//
// Phase 6: this component is now controlled by the parent — `phase` is fed
// from NDJSON events the backend emits as it works. Each phase event marks
// the currently-active step. When `phase === 'ai'`, the bar pins at 100%
// and the icon spins (matches the old "overrun" visual) until the parent
// unmounts on the final 'complete' event.
//
// If `phase` is omitted/undefined, the component falls back to the original
// self-paced timer (drop-in compatible with any caller that doesn't yet
// know about phase events).

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

export type LoadingPhase = (typeof STEPS)[number]['k'];

type Props = { phase?: LoadingPhase | null };

export function Loading({ phase }: Props = {}) {
  const controlled = phase !== undefined;

  // Self-paced timer state — only used when `phase` is not controlled.
  const [timerIdx, setTimerIdx] = useState(0);
  useEffect(() => {
    if (controlled) return;
    if (timerIdx >= STEPS.length) return; // hold on the last step
    const delay = timerIdx === 0 ? 380 : 600 + Math.random() * 250;
    const t = setTimeout(() => setTimerIdx((i) => i + 1), delay);
    return () => clearTimeout(t);
  }, [timerIdx, controlled]);

  // In controlled mode, idx is the step the backend is currently working on.
  // Initial render before any phase event lands defaults to step 0 (parse)
  // — matches what the user expects after pressing submit.
  const phaseIdx = phase ? STEPS.findIndex((s) => s.k === phase) : 0;
  const idx = controlled ? Math.max(0, phaseIdx) : timerIdx;

  // Overrun (timer-only): all steps "done" except step 5 stays active.
  const overrun = !controlled && timerIdx >= STEPS.length;
  const activeIdx = overrun ? STEPS.length - 1 : idx;

  // Progress percent. In controlled mode, weight the bar so `ai` reads 100%
  // (matches the old overrun visual). In uncontrolled timer mode, keep the
  // existing formula so visual snapshots don't drift.
  const pct = controlled
    ? Math.min(100, ((idx + 1) / STEPS.length) * 100)
    : overrun
      ? 100
      : Math.min(100, (idx / STEPS.length) * 100);

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
            const done = !overrun && i < activeIdx;
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
