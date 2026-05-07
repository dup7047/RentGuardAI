// ISR-cached building result page.
// Used for post-lookup redirects (?fresh=1 bypasses ISR once) and
// the SEO-indexed public archive (Phase 3.10).

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getBuildingByBbl } from '@/lib/api/backend';
import { BuildingReport } from '@/components/BuildingReport';

export const revalidate = 86400; // 24h ISR

type Props = { params: Promise<{ bbl: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { bbl } = await params;
  return {
    title: `Building ${bbl} — RentGuard NYC`,
    description: `Public-records risk summary for NYC building BBL ${bbl}. HPD violations, evictions, landlord watchlist.`,
  };
}

export default async function BuildingPage({ params }: Props) {
  const { bbl } = await params;
  const r = await getBuildingByBbl(bbl);
  if (r.kind !== 'success') notFound();
  return <BuildingReport data={r} />;
}
