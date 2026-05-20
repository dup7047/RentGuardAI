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
