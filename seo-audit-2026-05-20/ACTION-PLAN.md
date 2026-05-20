# RentGuard NYC — Prioritized SEO Action Plan

Generated 2026-05-20 from FULL-AUDIT-REPORT.md. Each item lists the affected file, a one-line fix, and expected impact. Code locations are relative to repo root.

---

## CRITICAL — fix this week

### C1. Add canonical tags to every page
**Why**: No page carries `<link rel="canonical">`. Combined with `/lookup` returning identical HTML to `/`, this is a textbook duplicate-content trap.

**Fix**: Use Next.js App Router metadata `alternates.canonical`.

- [frontend/app/layout.tsx:24](frontend/app/layout.tsx:24) — add `alternates: { canonical: '/' }` to the root metadata (acts as default).
- For pages with their own metadata export ([frontend/app/how-it-works/page.tsx](frontend/app/how-it-works/page.tsx), `/coverage`, `/for-landlords`, `/pricing`, `/how-we-make-money`, `/legal/*`), add `alternates: { canonical: '/how-it-works' }` etc.
- [frontend/app/building/[bbl]/page.tsx:17](frontend/app/building/[bbl]/page.tsx:17) — inside `generateMetadata`, add `alternates: { canonical: \`/building/${bbl}\` }`.

**Effort**: 1 hour. **Impact**: removes duplicate-content risk, locks in preferred URL.

---

### C2. Remove `/lookup` from the sitemap and make the redirect permanent
**Why**: `/lookup` 307-redirects to `/` but is still listed at `priority=0.9` in `sitemap.xml`. Search engines waste crawl budget; URL-equity is split.

**Fix**:
- Delete line 50 of [frontend/app/sitemap.ts](frontend/app/sitemap.ts:50) (`{ url: 'https://www.rentguard.cc/lookup', ... }`).
- Either: keep [frontend/app/lookup/page.tsx](frontend/app/lookup/page.tsx) but change the redirect to be served by `next.config.ts` so it returns 301 permanent. Add to `next.config.ts`:
  ```ts
  async redirects() {
    return [{ source: '/lookup', destination: '/', permanent: true }];
  }
  ```
  Then delete `frontend/app/lookup/page.tsx`.

**Effort**: 15 minutes. **Impact**: eliminates duplicate-content + signals permanent move to crawlers.

---

### C3. Stop sending `Cache-Control: no-store` on the homepage HTML
**Why**: Headers observed on `/`: `cache-control: private, no-cache, no-store, max-age=0, must-revalidate`. This defeats Vercel's edge cache for the public marketing route and prevents intermediary caches search engines may operate.

**Investigation needed**: identify where the header is set — most likely in middleware or a route segment config. Search for `no-store` and `headers()` in the frontend repo.

**Fix target**: marketing routes (`/`, `/how-it-works`, `/coverage`, `/for-landlords`, `/pricing`, `/how-we-make-money`, `/legal/*`) should serve:
```
Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400
```
Authenticated dashboard routes can keep `no-store`.

**Effort**: 1–2 hours (depends on where header originates). **Impact**: faster TTFB worldwide, better LCP, lower Vercel bandwidth.

---

## HIGH — fix this month

### H1. Add a default OG image
**Why**: Only `/building/[bbl]/opengraph-image.tsx` generates one. Sharing the homepage to LinkedIn/Twitter/Slack shows a blank text card.

**Fix**: Create `frontend/app/opengraph-image.tsx` using the existing OG generation pattern (1200×630 ImageResponse with logo + tagline "AI-powered NYC building risk lookup. Free."). Pages without their own OG image inherit this.

**Effort**: 1–2 hours. **Impact**: better social CTR, higher referral traffic from shared links.

---

### H2. Add a security-headers block
**Why**: Only HSTS is set. Missing `nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`. Google publicly treats HTTPS as a ranking signal; while individual headers aren't ranking signals, they are listed in Lighthouse "Best practices" which contribute to SEO audit scores and are increasingly checked by AI crawlers for trust.

**Fix**: Add to [frontend/next.config.ts:18](frontend/next.config.ts:18) `headers()`:
```ts
{
  source: '/(.*)',
  headers: [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  ],
},
```
Also set `poweredByHeader: false` at the top level to drop `x-powered-by: Next.js`.

CSP can be added in a follow-up — start in `Content-Security-Policy-Report-Only` mode using the Vercel report endpoint.

**Effort**: 30 minutes (without CSP). **Impact**: clean security audit, AI/trust signal.

---

### H3. Add `Organization` + `WebSite` + `SearchAction` JSON-LD to the root layout
**Why**: Currently no brand-level structured data exists. AI engines cannot disambiguate "RentGuard" from the UK landlord-insurance brand of the same name.

**Fix**: In [frontend/app/layout.tsx:50](frontend/app/layout.tsx:50), inject:
```tsx
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": "https://www.rentguard.cc/#org",
    "name": "RentGuard NYC",
    "legalName": "RentGuard NYC LLC",
    "url": "https://www.rentguard.cc",
    "logo": "https://www.rentguard.cc/logo-lockup.png",
    "areaServed": { "@type": "City", "name": "New York City" },
    "email": "support@rentguard.cc",
    "sameAs": [/* add twitter, linkedin URLs here */],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": "https://www.rentguard.cc/#website",
    "url": "https://www.rentguard.cc",
    "name": "RentGuard NYC",
    "publisher": { "@id": "https://www.rentguard.cc/#org" },
    "potentialAction": {
      "@type": "SearchAction",
      "target": "https://www.rentguard.cc/?q={search_term_string}",
      "query-input": "required name=search_term_string"
    }
  }
]) }} />
```
Note: confirm the homepage form actually accepts `?q=` — if not, wire it.

**Effort**: 1 hour. **Impact**: brand disambiguation, Google Sitelinks Searchbox eligibility, AI citation quality.

---

### H4. Include the address in building-page titles and add an H1
**Why**: Current title `Building 4032510071 — RentGuard NYC` drops the address keyword. The page has no H1, only an H2.

**Fix**:
- [frontend/app/building/[bbl]/page.tsx:17](frontend/app/building/[bbl]/page.tsx:17): hydrate the report inside `generateMetadata` (re-call `getBuildingByBbl` or pass through ISR cache) and build:
  ```ts
  title: `${address} risk report — RentGuard NYC`,
  description: `${address} (${borough}, NY): ${openViolations} HPD violations, ${evictions} evictions on file. Free RentGuard risk score.`,
  ```
- In the `BuildingReport` component, promote the address from an `<h2>` to an `<h1>`.
- Add a "Score: 97/100 — minimal concern" line as a `<p>` subtitle.

**Effort**: 2 hours. **Impact**: massive — every building page becomes long-tail discoverable by address ("85 Greenway Terrace violations").

---

### H5. Create `/llms.txt`
**Why**: Site advertises itself as "AI Rental Copilot" but the `llms.txt` endpoint 404s.

**Fix**: Add a route handler at `frontend/app/llms.txt/route.ts`:
```ts
export function GET() {
  const body = `# RentGuard NYC
> Free AI-powered building risk lookup for NYC renters,
> built on NYC Open Data sources.

## Canonical pages
- [How it works](https://www.rentguard.cc/how-it-works)
- [Coverage — data sources](https://www.rentguard.cc/coverage)
- [For landlords](https://www.rentguard.cc/for-landlords)
- [Pricing](https://www.rentguard.cc/pricing)
- [How we make money](https://www.rentguard.cc/how-we-make-money)
- [Disclaimers](https://www.rentguard.cc/legal/disclaimer)

## Data sources
- HPD Open Violations (NYC.gov)
- DOB Complaints (NYC.gov)
- Marshal Evictions (NYC.gov)
- Worst Landlord Watchlist (NYC Public Advocate)
- FARE Act compliance signals

## Out of scope
- Properties outside NYC
- Co-op board approvals
- Insurance / financial products`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
```
Also add an `/llms-full.txt` if you want a richer index.

**Effort**: 30 minutes. **Impact**: AI crawler index, ChatGPT/Perplexity citation likelihood.

---

### H6. Promote H3 → H2 on marketing pages; add H1 to building pages
**Why**: Marketing pages currently jump H1 → H3, skipping H2. Building pages have no H1. Both are semantic-structure bugs that lower content-quality audit scores.

**Fix**: Search for the `<h3>` blocks on [frontend/app/how-it-works/page.tsx](frontend/app/how-it-works/page.tsx), `/coverage`, `/for-landlords`, `/how-we-make-money` and change the first-level section headings to `<h2>`. Keep `<h3>` only for sub-sections within each `<h2>`.

**Effort**: 1 hour. **Impact**: cleaner outline for search engines and screen readers.

---

### H7. Add `lastModified` to static URLs in the sitemap
**Why**: Sitemap currently emits no `<lastmod>` for marketing or legal URLs. Search engines down-weight those URLs in crawl scheduling.

**Fix**: In [frontend/app/sitemap.ts:26](frontend/app/sitemap.ts:26)–[46](frontend/app/sitemap.ts:46), inject `lastModified: new Date('YYYY-MM-DD')` (use the page's last-edit date, or `new Date()` per ISR run).

**Effort**: 15 minutes. **Impact**: better crawl scheduling.

---

## MEDIUM — fix this quarter

### M1. Add `FAQPage` schema to `/pricing`, `/how-we-make-money`, `/for-landlords`
Each page already answers common questions in prose. Wrap them in `<dt>/<dd>` or section markers and emit `FAQPage` JSON-LD. Unlocks rich results + AI-answer extraction.

### M2. Add `HowTo` schema to `/how-it-works`
Three-step process maps cleanly to schema.org `HowTo` with `step` array.

### M3. Add `BreadcrumbList` JSON-LD to building pages
`Home › Coverage › Queens › 85 Greenway Terrace`. Eligible for breadcrumb rich result.

### M4. Fix the truncated description in building `Place` schema
In [frontend/app/building/[bbl]/page.tsx](frontend/app/building/[bbl]/page.tsx) (or wherever the secondary JSON-LD is emitted — observed in the rendered HTML but not in the file fetched above), use sentence-boundary truncation:
```ts
function trim(text: string, max = 300) {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf('. ', max);
  return cut > max * 0.5 ? text.slice(0, cut + 1) : text.slice(0, max - 1) + '…';
}
```

### M5. Normalize `addressLocality` casing
Schema accepts any case but `"QUEENS"` looks like a shouty rich result. Title-case it: `"Queens"`.

### M6. Add `geo` to building schema
Use BBL → BIN → lat/lng via the same NYC datasets you already pull, attach `geo: { @type: GeoCoordinates, latitude, longitude }`. Eligible for Google Maps integration.

### M7. Internal-link top-performing building pages from marketing surface
On `/coverage`, add a "Recently published reports" block linking to 6–10 building pages (rotated weekly). On `/for-landlords`, add "See how your building looks → [example]" link.

### M8. Trim `/how-it-works` meta description from 170 → ~155 chars
Drops the tail-clipping risk in SERPs.

### M9. Add an "About / team" page with named operators
Strengthens E-E-A-T for a YMYL-adjacent domain. Even one named founder with brief bio and LinkedIn `sameAs` link is enough to move the needle.

### M10. Submit sitemap to Google Search Console + Bing Webmaster Tools
Confirm via the property; verify the sitemap is being read; monitor index coverage. (Operational, not code.)

---

## LOW — backlog

### L1. Generate `humans.txt`, `security.txt`, `ads.txt` if relevant
`security.txt` is the highest-value of these for a trust-sensitive site.

### L2. Consider `IndexNow` integration
Vercel + Next.js has community plugins to ping IndexNow on deploy — useful once building inventory grows.

### L3. Twitter card → `summary_large_image` on marketing pages
After H1 (OG image) ships, switch `twitter:card` from `summary` to `summary_large_image` and set `twitter:image` to the same asset.

### L4. Remove the `priority` field from sitemap entries
Google has publicly stated `priority` is ignored. Keeping it doesn't hurt, but the values currently set (1, 0.9, 0.7, 0.3) signal a slight misunderstanding — `/lookup` should not be more important than `/how-it-works`. Either fix the values or drop the field.

### L5. Add `data-vercel-speed-insights` or a real RUM beacon
Cloudflare Web Analytics is page-view only. Vercel Speed Insights captures CWV field data which then feeds CrUX — currently the origin is not in CrUX, so you have no field data anywhere. Adding a RUM beacon is the only way to get field data before traffic reaches the CrUX threshold.

### L6. Add `noindex` to `/legal/disclaimer`?
Optional — disclaimer pages rarely earn traffic and can clutter sitemap. Recommend leaving them indexed for transparency.

---

## Suggested first-PR scope

Bundle these into one branch and ship together — all are config-/metadata-level and low-risk:

1. C1 (canonicals — root layout default + per-page)
2. C2 (remove `/lookup` from sitemap, convert to 301)
3. H1 (default OG image)
4. H2 (security headers + `poweredByHeader: false`)
5. H3 (`Organization` + `WebSite` JSON-LD in layout)
6. H5 (`/llms.txt` route)
7. H7 (sitemap `lastModified`)

Combined effort: ~half a day. Expected SEO Health Score lift: ~61 → ~78.

Building-page improvements (H4 + M3 + M4) should be a second PR — they need data-flow changes (`generateMetadata` must hydrate report data).

