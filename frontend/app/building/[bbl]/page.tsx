// ISR-cached building result page.
// Used for post-lookup redirects (?fresh=1 forces a fresh backend fetch
// bypassing the Next.js data cache) and the SEO-indexed public archive.

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBuildingByBbl } from '@/lib/api/backend';
import { BuildingReport } from '@/components/BuildingReport';

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
  if (r.kind !== 'success') notFound();
  return <BuildingReport data={r} />;
}
