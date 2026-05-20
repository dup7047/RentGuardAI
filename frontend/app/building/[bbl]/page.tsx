// ISR-cached building result page.
// Used for post-lookup redirects (?fresh=1 forces a fresh backend fetch
// bypassing the Next.js data cache) and the SEO-indexed public archive.

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBuildingByBbl } from '@/lib/api/backend';
import { BuildingReport } from '@/components/BuildingReport';
import { serializeJsonLd } from '@/lib/seo/structured-data';

export const revalidate = 86400; // 24h ISR (upper bound on staleness)

type Props = {
  params: Promise<{ bbl: string }>;
  searchParams: Promise<{ fresh?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { bbl } = await params;
  return {
    title: `Building ${bbl} — RentGuard NYC`,
    description: `Public-records risk summary for NYC building BBL ${bbl}. HPD violations, evictions, landlord watchlist.`,
  };
}

export default async function BuildingPage({ params, searchParams }: Props) {
  const { bbl } = await params;
  const sp = await searchParams;
  // ?fresh=1 means the user just completed a /v1/lookup and we want them to
  // see the just-generated score / listing summary / scraped listing
  // immediately — bypass the Next.js fetch cache for this render.
  const isFresh = sp.fresh === '1';
  const r = await getBuildingByBbl(bbl, { noStore: isFresh });
  if (r.kind === 'not_found') notFound();
  if (r.kind !== 'success') {
    const message = 'message' in r && typeof r.message === 'string' ? r.message : undefined;
    throw new Error(
      `Building report unavailable for BBL ${bbl}${message ? `: ${message}` : ''}`,
    );
  }

  const jsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Residence',
    name: r.address ?? `BBL ${bbl}`,
    address: {
      '@type': 'PostalAddress',
      ...(r.address ? { streetAddress: r.address } : {}),
      ...(r.borough ? { addressLocality: r.borough } : {}),
      addressRegion: 'NY',
      addressCountry: 'US',
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <BuildingReport data={r} />
    </>
  );
}
