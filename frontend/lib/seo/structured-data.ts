// JSON-LD structured data for building result pages.
// Injected into BuildingReport.tsx as <script type="application/ld+json">.

export function buildingJsonLd(data: {
  address: string;
  bbl: string;
  summary: string;
  borough?: string;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: data.address,
    identifier: data.bbl,
    description: data.summary.slice(0, 280),
    address: {
      '@type': 'PostalAddress',
      addressLocality: data.borough ?? 'New York',
      addressRegion: 'NY',
      addressCountry: 'US',
    },
  };
}
