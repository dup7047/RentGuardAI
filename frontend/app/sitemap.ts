import type { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';

export const revalidate = 3600; // Regenerate sitemap every hour via ISR

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  let buildingUrls: MetadataRoute.Sitemap = [];
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('buildings')
      .select('bbl, last_fetched_at')
      .not('last_fetched_at', 'is', null)
      .limit(50_000);

    buildingUrls = (data ?? []).map((row) => ({
      url: `https://www.rentguard.cc/building/${row.bbl}`,
      lastModified: new Date(row.last_fetched_at as string),
      changeFrequency: 'weekly' as const,
    }));
  } catch {
    // Sitemap generates even if DB is unreachable (empty building list)
  }

  const marketingUrls: MetadataRoute.Sitemap = [
    'how-it-works',
    'coverage',
    'for-landlords',
    'pricing',
    'how-we-make-money',
  ].map((slug) => ({
    url: `https://www.rentguard.cc/${slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
  }));

  const legalUrls: MetadataRoute.Sitemap = [
    'legal/terms',
    'legal/privacy',
    'legal/disclaimer',
  ].map((slug) => ({
    url: `https://www.rentguard.cc/${slug}`,
    lastModified: now,
    changeFrequency: 'yearly' as const,
  }));

  return [
    {
      url: 'https://www.rentguard.cc/',
      lastModified: now,
      changeFrequency: 'daily',
    },
    ...marketingUrls,
    ...legalUrls,
    ...buildingUrls,
  ];
}
