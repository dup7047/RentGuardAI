import { ImageResponse } from 'next/og';

export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

type Data = {
  kind: string;
  address?: string;
  borough?: string;
  stats?: { hpd_violations_open: number };
};

export default async function Image({ params }: { params: Promise<{ bbl: string }> }) {
  const { bbl } = await params;

  let data: Data = { kind: 'not_found' };
  try {
    const base = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8080';
    const res = await fetch(`${base}/v1/building/${bbl}`, {
      // @ts-ignore next extended fetch
      next: { revalidate: 86400 },
    });
    data = (await res.json()) as Data;
  } catch {
    // Fallback to generic OG if API unavailable
  }

  const headline =
    data.kind === 'success'
      ? `${data.stats?.hpd_violations_open ?? 0} open HPD violations`
      : 'Building report';
  const address = data.address ?? `BBL ${bbl}`;
  const borough = data.borough ? ` · ${data.borough}` : '';

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
          background: '#0a0a0a',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <p style={{ fontSize: 28, opacity: 0.55, margin: 0, marginBottom: 16 }}>
          RentGuard NYC — Public Records
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
        <p style={{ fontSize: 40, margin: 0, opacity: 0.8 }}>{headline}</p>
        <p style={{ fontSize: 22, margin: 0, marginTop: 32, opacity: 0.45 }}>
          Always verify records yourself · Not legal advice
        </p>
      </div>
    ),
    size,
  );
}
