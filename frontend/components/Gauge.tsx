// Animated SVG score-ring gauge, ported from the design prototype.
// Tone derivation is REPLACED with our backend's `score_band` semantics
// (0–100 where 100 = safest), so high score → green, low score → red.

'use client';

import { useEffect, useState } from 'react';

import { getReportTone, type ReportTone, type ScoreBand } from '@/lib/api/backend';

function useCountUp(target: number, duration = 900): number {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target)) {
      setVal(target);
      return;
    }
    let raf = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const t = Math.min(1, (ts - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return val;
}

const COLOR: Record<ReportTone, string> = {
  good: 'oklch(0.62 0.13 155)',
  warn: 'oklch(0.70 0.14 70)',
  bad: 'oklch(0.60 0.18 25)',
};

export function Gauge({
  score,
  band,
  size = 96,
  stroke = 8,
}: {
  score: number;
  band: ScoreBand | null;
  size?: number;
  stroke?: number;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const animScore = useCountUp(score, 1100);
  const pct = Math.min(100, Math.max(0, animScore));
  const offset = c - (pct / 100) * c;
  const color = COLOR[getReportTone(band)];

  return (
    <div className="gauge" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="oklch(0.93 0.012 250)"
          strokeWidth={stroke}
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset .25s linear' }}
        />
      </svg>
      <div className="val">
        {animScore}
        <small>/ 100</small>
      </div>
    </div>
  );
}
