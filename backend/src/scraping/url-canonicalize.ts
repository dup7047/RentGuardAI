// Strip tracking params + normalize host so cache keys collapse consistently.
// Example: https://STREETEASY.com/rental/123/?utm_source=email&fbclid=abc#gallery
//          → https://streeteasy.com/rental/123

const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|_hsenc$|_hsmi$|ref$|source$|medium$|campaign$|s_kwcid$)/i;

export function canonicalizeListingUrl(input: string): string {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    // Not a URL we can parse — return original so callers can decide what to do
    return input.trim();
  }

  // Drop hash entirely (anchors don't change resource identity)
  parsed.hash = '';

  // Strip tracking-only query params; preserve everything else
  const newParams = new URLSearchParams();
  for (const [k, v] of parsed.searchParams) {
    if (!TRACKING_PARAM.test(k)) newParams.set(k, v);
  }
  parsed.search = newParams.toString();

  // Lowercase host (URL spec allows mixed case but we want one cache key per resource)
  parsed.hostname = parsed.hostname.toLowerCase();

  // Drop trailing slash on the path EXCEPT for the root "/"
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // Drop default ports (URL.toString already handles this, but be explicit)
  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  return parsed.toString();
}

/**
 * Detect the host family for routing to per-source extractors.
 * Returns null when the URL parser fails.
 */
export function detectListingHost(input: string): { host: string; source: 'streeteasy' | 'zillow' | 'generic' } | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'streeteasy.com' || host.endsWith('.streeteasy.com')) {
    return { host, source: 'streeteasy' };
  }
  if (host === 'zillow.com' || host.endsWith('.zillow.com')) {
    return { host, source: 'zillow' };
  }
  return { host, source: 'generic' };
}
