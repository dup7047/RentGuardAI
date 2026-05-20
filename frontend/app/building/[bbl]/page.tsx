// ISR-cached building result page.
// Used for post-lookup redirects (?fresh=1 forces a fresh backend fetch
// bypassing the Next.js data cache) and the SEO-indexed public archive.

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBuildingByBbl } from '@/lib/api/backend';
import { BuildingReport } from '@/components/BuildingReport';
import { serializeJsonLd, titleCaseBorough } from '@/lib/seo/structured-data';

export const revalidate = 86400; // 24h ISR (upper bound on staleness)

const SITE_URL = 'https://www.rentguard.cc';

type Props = {
  params: Promise<{ bbl: string }>;
  searchParams: Promise<{ fresh?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { bbl } = await params;
  // getBuildingByBbl is ISR-cached with revalidate=3600; calling it here
  // and again in the default export is deduped by Next.js within a render.
  const r = await getBuildingByBbl(bbl);

  const hasData = r.kind === 'success' && r.address;
  const address = hasData ? r.address : `BBL ${bbl}`;
  const borough = hasData && r.borough ? titleCaseBorough(r.borough) : null;
  const titleCore = hasData ? `${address} risk report` : `Building ${bbl}`;
  const description = hasData
    ? `${address}${borough ? ` (${borough}, NY)` : ''}: public-records risk score, HPD violations, evictions, and landlord watchlist. Free RentGuard report.`
    : `Public-records risk summary for NYC building BBL ${bbl}. HPD violations, evictions, landlord watchlist.`;

  return {
    title: `${titleCore} — RentGuard NYC`,
    description,
    alternates: { canonical: `/building/${bbl}` },
    openGraph: {
      title: titleCore,
      description,
      url: `${SITE_URL}/building/${bbl}`,
      type: 'website',
    },
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

  const borough = titleCaseBorough(r.borough);
  const residenceJsonLd: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Residence',
    name: r.address ?? `BBL ${bbl}`,
    address: {
      '@type': 'PostalAddress',
      ...(r.address ? { streetAddress: r.address } : {}),
      addressLocality: borough,
      addressRegion: 'NY',
      addressCountry: 'US',
    },
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: SITE_URL },
      { '@type': 'ListItem', position: 2, name: 'Coverage', item: `${SITE_URL}/coverage` },
      ...(r.borough
        ? [
            {
              '@type': 'ListItem',
              position: 3,
              name: borough,
              item: `${SITE_URL}/coverage`,
            },
          ]
        : []),
      {
        '@type': 'ListItem',
        position: r.borough ? 4 : 3,
        name: r.address ?? `BBL ${bbl}`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(residenceJsonLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }}
      />
      <BuildingReport data={r} />
    </>
  );
}
