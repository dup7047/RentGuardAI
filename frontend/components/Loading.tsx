// 6-step animated loading interstitial. Shown by LookupForm while the
// /v1/lookup/stream POST is in flight.
//
// Phase 6.1: the visible animation is decoupled from the raw backend
// event stream. We track the parent-supplied `phase` as a TARGET (where
// the backend says we are), and advance the visible step toward it with
// a minimum dwell time per step. This way:
//   - cache-hit lookups (5 events in 100 ms) don't flash through;
//     each visible step lingers ~700 ms so the user sees progress
//   - long phases (e.g., scrape, AI) just sit on the active step with
//     the spinner, exactly as before
//
// If `phase` is omitted/undefined, the component falls back to the
// original self-paced timer (drop-in compatible).

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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

const FIRST_DWELL_MS = 380;
const MIN_DWELL_MS = 700;

export function Loading({ phase }: Props = {}) {
  const controlled = phase !== undefined;

  // displayIdx is the step currently visible to the user. It only ever
  // moves forward, gated by min dwell time.
  const [displayIdx, setDisplayIdx] = useState(0);
  const lastAdvanceRef = useRef<number>(Date.now());

  // Target: where the backend says we should be. Only used in controlled mode.
  const targetIdx = useMemo(() => {
    if (!controlled) return STEPS.length; // unused
    if (!phase) return 0;
    const i = STEPS.findIndex((s) => s.k === phase);
    return i < 0 ? 0 : i;
  }, [controlled, phase]);

  // Controlled mode: advance displayIdx toward targetIdx, one step at a time,
  // with minimum dwell between transitions.
  useEffect(() => {
    if (!controlled) return;
    if (displayIdx >= targetIdx) return;
    const sinceLast = Date.now() - lastAdvanceRef.current;
    const minDwell = displayIdx === 0 ? FIRST_DWELL_MS : MIN_DWELL_MS;
    const wait = Math.max(0, minDwell - sinceLast);
    const t = setTimeout(() => {
      lastAdvanceRef.current = Date.now();
      setDisplayIdx((i) => Math.min(i + 1, targetIdx));
    }, wait);
    return () => clearTimeout(t);
  }, [controlled, displayIdx, targetIdx]);

  // Uncontrolled mode: original self-paced timer.
  useEffect(() => {
    if (controlled) return;
    if (displayIdx >= STEPS.length) return;
    const delay = displayIdx === 0 ? FIRST_DWELL_MS : 600 + Math.random() * 250;
    const t = setTimeout(() => setDisplayIdx((i) => i + 1), delay);
    return () => clearTimeout(t);
  }, [controlled, displayIdx]);

  // Elapsed-seconds counter — shown under the subtitle so impatient users
  // have a sense of progress on cold starts (Render can take 25–35 s).
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(t);
  }, []);

  // Overrun (uncontrolled timer reached the end before parent unmounted):
  // pin the bar at 100 % and keep step 5 active.
  const overrun = !controlled && displayIdx >= STEPS.length;
  const activeIdx = overrun ? STEPS.length - 1 : displayIdx;

  // Progress percent. In controlled mode, weight the bar so `ai` reads 100 %.
  // In uncontrolled mode, keep the original formula so the existing visual
  // is unchanged.
  const pct = controlled
    ? Math.min(100, ((activeIdx + 1) / STEPS.length) * 100)
    : overrun
      ? 100
      : Math.min(100, (displayIdx / STEPS.length) * 100);

  return (
    <div className="loading-wrap screen-fade">
      <div className="loading-card">
        <div className="header">
          <div style={{ width: 40, height: 40, display: 'grid', placeItems: 'center' }}>
            <Mark size={36} />
          </div>
          <div>
            <h3>Reading the listing & public records…</h3>
            <span>
              {elapsed < 5
                ? "This usually takes 10–30 seconds. Don't close this tab."
                : `${elapsed}s elapsed · usually 10–30 seconds.`}
            </span>
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
