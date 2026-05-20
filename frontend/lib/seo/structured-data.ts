// JSON-LD structured data for building result pages.
// Injected into BuildingReport.tsx as <script type="application/ld+json">.

// Cap descriptions at a sentence boundary instead of slicing mid-word.
// Google's Place schema can swallow long blocks but renders look cleaner
// when the text ends in punctuation, not a hyphen or partial word.
export function truncateAtSentence(text: string, max = 280): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('. ', max);
  return cut > max * 0.5 ? text.slice(0, cut + 1) : text.slice(0, max - 1) + '…';
}

// HPD borough names arrive as upper-case ("QUEENS"). Title-case them so the
// rendered rich result reads as a proper noun.
export function titleCaseBorough(borough: string | null | undefined): string {
  if (!borough) return 'New York';
  return borough
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

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
    description: truncateAtSentence(data.summary, 280),
    address: {
      '@type': 'PostalAddress',
      addressLocality: titleCaseBorough(data.borough),
      addressRegion: 'NY',
      addressCountry: 'US',
    },
  };
}
