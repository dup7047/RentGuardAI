import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type ScoreBand = 'minimal' | 'moderate' | 'elevated' | 'high';

type Data = {
  kind: string;
  address?: string;
  borough?: string;
  score?: number | null;
  score_band?: ScoreBand | null;
  stats?: { hpd_violations_open: number };
  landlord?: { watchlist_rank: number | null };
};

// Color the score by the backend's classification band. Higher score = better
// building, so 'minimal' (low risk) is green and 'high' (worst) is red.
const BAND_COLORS: Record<ScoreBand, string> = {
  minimal: '#22A559',
  moderate: '#E8A33D',
  elevated: '#E07B3C',
  high: '#C44537',
};
// Used when a building hasn't been scored yet (rare on cached pages).
const NEUTRAL_COLOR = '#9ca3af';

export default async function Image({ params }: { params: Promise<{ bbl: string }> }) {
  const { bbl } = await params;

  let data: Data = { kind: 'not_found' };
  try {
    // Mirror the URL resolution in lib/api/backend.ts so the OG image works on
    // Vercel prod without requiring a dashboard-side NEXT_PUBLIC_BACKEND_URL.
    // Without this, prod fell back to localhost and every shared card rendered
    // the generic "Building report" template instead of the score card.
    const base =
      process.env.NEXT_PUBLIC_BACKEND_URL ??
      (process.env.NODE_ENV === 'production'
        ? 'https://rentguardai.onrender.com'
        : 'http://localhost:8080');
    const res = await fetch(`${base}/v1/building/${bbl}`, {
      // @ts-ignore next extended fetch
      next: { revalidate: 86400 },
    });
    data = (await res.json()) as Data;
  } catch {
    // Fallback to generic OG if API unavailable
  }

  if (data.kind !== 'success') {
    return new ImageResponse(
      (
        <div
          style={{
            width: 1200,
            height: 630,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: 80,
            position: 'relative',
            background: '#0a0a0a',
            color: 'white',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <p style={{ fontSize: 28, opacity: 0.55, margin: 0, marginBottom: 16 }}>
            RentGuard NYC: Public Records
          </p>
          <p
            style={{
              fontSize: 58,
              fontWeight: 800,
              margin: 0,
              marginBottom: 8,
              lineHeight: 1.15,
            }}
          >
            {data.address ?? `BBL ${bbl}`}
          </p>
          <p style={{ fontSize: 40, margin: 0, opacity: 0.8 }}>Building report</p>
          <p style={{ fontSize: 22, margin: 0, marginTop: 32, opacity: 0.45 }}>
            Always verify records yourself · Not legal advice
          </p>
          <p
            style={{
              position: 'absolute',
              bottom: 24,
              left: 0,
              right: 0,
              textAlign: 'center',
              fontSize: 24,
              margin: 0,
              color: '#9ca3af',
            }}
          >
            rentguard.cc, check your building free
          </p>
        </div>
      ),
      size,
    );
  }

  const openViolations = data.stats?.hpd_violations_open ?? 0;
  const score = data.score ?? null;
  const scoreColor = data.score_band ? BAND_COLORS[data.score_band] : NEUTRAL_COLOR;
  const address = data.address ?? `BBL ${bbl}`;
  const borough = data.borough ? ` · ${data.borough}` : '';
  const rank = data.landlord?.watchlist_rank;
  const showBadge = rank != null && rank <= 100;

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          position: 'relative',
          padding: 80,
          background: '#0a0a0a',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {showBadge && (
          <div
            style={{
              position: 'absolute',
              top: 48,
              right: 48,
              padding: '12px 28px',
              background: '#C44537',
              color: 'white',
              fontSize: 32,
              fontWeight: 700,
              borderRadius: 999,
              display: 'flex',
            }}
          >
            Worst Landlord 2026 · #{rank}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            flex: 1,
          }}
        >
          <p style={{ fontSize: 28, opacity: 0.55, margin: 0, marginBottom: 16 }}>
            RentGuard NYC: Public Records
          </p>
          <p
            style={{
              fontSize: 58,
              fontWeight: 800,
              margin: 0,
              marginBottom: 8,
              lineHeight: 1.15,
            }}
          >
            {address}
            {borough}
          </p>
          <p style={{ fontSize: 36, margin: 0, opacity: 0.8 }}>
            {openViolations} open HPD violations
          </p>
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            paddingLeft: 60,
          }}
        >
          <span
            style={{
              fontSize: 200,
              fontWeight: 900,
              lineHeight: 1,
              color: scoreColor,
            }}
          >
            {score ?? '—'}
          </span>
          <span
            style={{
              fontSize: 32,
              marginTop: 8,
              color: '#9ca3af',
              letterSpacing: 1,
            }}
          >
            {score != null ? '/ 100' : 'score pending'}
          </span>
        </div>

        <p
          style={{
            position: 'absolute',
            bottom: 24,
            left: 0,
            right: 0,
            textAlign: 'center',
            fontSize: 24,
            margin: 0,
            color: '#9ca3af',
          }}
        >
          rentguard.cc, check your building free
        </p>
      </div>
    ),
    size,
  );
}
