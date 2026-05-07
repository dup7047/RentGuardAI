import type { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';

export const revalidate = 3600; // Regenerate sitemap every hour via ISR

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
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
      priority: 0.7,
    }));
  } catch {
    // Sitemap generates even if DB is unreachable (empty building list)
  }

  return [
    { url: 'https://www.rentguard.cc/', changeFrequency: 'daily', priority: 1 },
    { url: 'https://www.rentguard.cc/lookup', changeFrequency: 'daily', priority: 0.9 },
    ...buildingUrls,
  ];
}
