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

// Built from char codes to avoid placing the literal U+2028 / U+2029
// characters in this source file — they're JS LineTerminators and would
// break a regex literal.
const LINE_SEP_RE = new RegExp(String.fromCharCode(0x2028), 'g');
const PARA_SEP_RE = new RegExp(String.fromCharCode(0x2029), 'g');

// JSON.stringify does NOT escape `<` or `/`, so a string value containing
// `</script>` would close the surrounding <script type="application/ld+json">
// element and execute attacker JS in our origin. Also escape U+2028/U+2029,
// which terminate JS string literals but are valid in JSON.
export function serializeJsonLd(obj: unknown): string {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(LINE_SEP_RE, '\\u2028')
    .replace(PARA_SEP_RE, '\\u2029');
}
