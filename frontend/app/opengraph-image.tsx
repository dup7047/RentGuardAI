import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = 'RentGuard NYC: free building risk lookup';

// Default OG card used for every page that doesn't define its own
// opengraph-image (homepage, marketing, legal). Building pages have their
// own dynamic card under app/building/[bbl]/opengraph-image.tsx.
export default function Image() {
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
          RentGuard NYC · AI Rental Copilot
        </p>
        <p
          style={{
            fontSize: 78,
            fontWeight: 800,
            margin: 0,
            marginBottom: 16,
            lineHeight: 1.05,
          }}
        >
          Look up any NYC building
        </p>
        <p
          style={{
            fontSize: 78,
            fontWeight: 800,
            margin: 0,
            marginBottom: 32,
            lineHeight: 1.05,
            color: '#22A559',
          }}
        >
          before you sign.
        </p>
        <p style={{ fontSize: 32, margin: 0, opacity: 0.8, lineHeight: 1.3 }}>
          HPD violations · DOB complaints · Marshal evictions · Worst Landlord
          Watchlist
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
          rentguard.cc, free for NYC renters
        </p>
      </div>
    ),
    size,
  );
}
