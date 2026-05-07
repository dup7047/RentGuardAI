// Phase 4.5: ScoreCard renders the deterministic 0-100 risk score plus the
// AI-narrated explanation and a factor breakdown. Sits at the top of the
// building report so users see the bottom line first.
//
// The score is COMPUTED IN CODE on the backend (src/scoring/score.ts), not by
// the AI — it's reproducible and auditable. The AI only narrates it.

import type { ScoreBand, ScoreFactor } from '@/lib/api/backend';

const BAND_LABEL: Record<ScoreBand, string> = {
  minimal: 'Minimal concern',
  moderate: 'Moderate concern',
  elevated: 'Elevated concern',
  high: 'High concern',
};

const BAND_COLOR: Record<ScoreBand, string> = {
  minimal: '#1f8a4c',     // green
  moderate: '#caa64a',    // amber-ish
  elevated: '#d27a35',    // orange
  high: '#c1383b',        // red
};

export function ScoreCard({
  score,
  band,
  factors,
  explanation,
}: {
  score: number | null;
  band: ScoreBand | null;
  factors: ScoreFactor[];
  explanation: string | null;
}) {
  if (score == null || band == null) return null;
  const color = BAND_COLOR[band];
  const label = BAND_LABEL[band];

  // Show the 5 most-impactful factors (positive or negative)
  const topFactors = [...factors].sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 5);

  return (
    <section className="score-card" aria-label="Risk score">
      <div className="score-card-row">
        <div
          className="score-circle"
          style={{ borderColor: color, color }}
          aria-label={`Score ${score} out of 100, ${label}`}
        >
          <strong className="score-number">{score}</strong>
          <span className="score-suffix">/100</span>
        </div>
        <div className="score-text">
          <h2 className="score-band-label" style={{ color }}>
            {label}
          </h2>
          {explanation && <p className="score-explanation">{explanation}</p>}
          <p className="score-disclaimer">
            Score is computed from public records using a fixed formula — not an AI verdict. See
            factors below.
          </p>
        </div>
      </div>

      {topFactors.length > 0 && (
        <details className="score-factors-details">
          <summary>What moved the score</summary>
          <ul className="score-factors-list">
            {topFactors.map((f) => (
              <li key={f.key} className={`score-factor ${f.impact < 0 ? 'negative' : f.impact > 0 ? 'positive' : 'neutral'}`}>
                <span className="score-factor-impact" aria-label={`impact ${f.impact}`}>
                  {f.impact === 0 ? '·' : f.impact > 0 ? `+${f.impact}` : `${f.impact}`}
                </span>
                <span className="score-factor-reason">{f.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
