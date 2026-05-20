# RentGuard NYC — Full SEO Audit Report

- **Site audited**: https://www.rentguard.cc/
- **Audit date**: 2026-05-20
- **Stack detected**: Next.js (App Router) on Vercel, Supabase backend, Cloudflare Web Analytics
- **Business type**: NYC-only consumer data / "AI rental copilot" (free building-risk lookup) — hybrid local-info SaaS, not e-commerce, not multi-location brick-and-mortar
- **Crawl scope**: 8 pages fetched directly (homepage + 6 marketing + 1 sample dynamic building); sitemap inspected (65 URLs total)

---

## Executive Summary

**Overall SEO Health Score: 61 / 100**

| Category | Weight | Score | Weighted |
|---|---|---|---|
| Technical SEO | 22% | 60 | 13.2 |
| Content Quality | 23% | 65 | 15.0 |
| On-Page SEO | 20% | 70 | 14.0 |
| Schema / Structured Data | 10% | 45 | 4.5 |
| Performance (CWV) | 10% | 70* | 7.0 |
| AI Search Readiness | 10% | 35 | 3.5 |
| Images | 5% | 85 | 4.3 |
| **Total** | **100%** | | **~61** |

*Performance score is an estimate from code review — PSI API was rate-limited and rentguard.cc has no CrUX field data yet (low traffic). See Performance section.*

### Top 5 critical issues

1. **No canonical tags on any page.** Every fetched HTML response (`/`, `/how-it-works`, `/coverage`, `/for-landlords`, `/pricing`, `/how-we-make-money`, `/building/[bbl]`) is missing `<link rel="canonical">`. Risk is high because of #2.
2. **`/lookup` 307-redirects to `/`** but is still listed as a separate URL in the sitemap with `priority=0.9`. Sitemap-listed redirect URLs waste crawl budget and signal duplicate content. (Source: [frontend/app/lookup/page.tsx](frontend/app/lookup/page.tsx) does `redirect('/')`; [frontend/app/sitemap.ts:50](frontend/app/sitemap.ts:50) still emits it.)
3. **No OG image on the homepage or any marketing page** — only `/building/[bbl]/opengraph-image.tsx` exists. Twitter shares from `/` will use a plain title card; social CTR will suffer.
4. **No security headers beyond HSTS.** No CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Referrer-Policy`, or `Permissions-Policy`. Google uses HTTPS + a clean security posture as a soft ranking signal; missing nosniff also weakens trust signals.
5. **Homepage cache-control is `private, no-cache, no-store, must-revalidate`** — kills CDN edge caching even though the homepage is fully static. This both hurts performance and blocks search-engine intermediary caches.

### Top 5 quick wins

1. Add a `<link rel="canonical">` to every page via the App Router `metadata.alternates.canonical` field — single shared helper in [frontend/app/layout.tsx](frontend/app/layout.tsx).
2. Remove `/lookup` from the sitemap and change the redirect to a permanent 301 (`redirect('/', RedirectType.replace)` is still 307; use a `next.config.ts` `redirects()` entry with `permanent: true`).
3. Generate a default OG image via Next.js opengraph-image convention at `frontend/app/opengraph-image.tsx` (1200×630, brand + tagline).
4. Add a `/llms.txt` route — site is positioned as "AI Rental Copilot" but currently returns 404 for the spec endpoint.
5. Add security headers in `next.config.ts` `headers()` (CSP report-only first, then `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), geolocation=(self)`).

---

## 1. Technical SEO  (Score: 60)

### Crawlability — OK
- `robots.txt` is minimal but correct: `User-Agent: *` / `Allow: /`, with sitemap reference.
- HTTPS enforced: `http://www.rentguard.cc/` returns 308 → HTTPS; non-www returns 307 → www. Both canonicalization redirects work.
- HSTS present: `strict-transport-security: max-age=63072000` (2 years, no preload directive).

### Indexability — Action needed
- **Cache-control `private, no-cache, no-store, max-age=0, must-revalidate`** on the homepage HTML. This is fine for an authenticated dashboard but wrong for a public marketing route — it prevents Vercel's edge cache, intermediary proxies, and even search-engine fetch caches from holding the response. Either the route is incorrectly opting out of static generation, or middleware is forcing this header.
- Pages do not carry `<meta name="robots">` overrides, which means defaults (`index,follow`) apply — correct.
- `/llms.txt` returns HTTP 404 (the Next.js not-found page, with `<meta name="robots" content="noindex">` — the 404 itself is correctly hidden, but the file is missing).

### Sitemap — Action needed
- Single sitemap at `/sitemap.xml`, valid XML, served via App Router [frontend/app/sitemap.ts](frontend/app/sitemap.ts) (ISR every 1h).
- **Only 65 URLs total** (10 static + 55 building). The supabase query is limited to 50,000 but the data set itself only has 55 buildings with `last_fetched_at IS NOT NULL`. This is expected for a young site but means there is currently almost no long-tail surface area for organic discovery.
- **`/lookup` should not be in the sitemap** — it is a redirect.
- **Static marketing URLs lack `lastModified`** in the sitemap output. Adding `lastModified: new Date()` (or git-derived dates) lets search engines re-prioritize crawl.

### Security headers — Action needed
Response headers observed on `/`:

```
strict-transport-security: max-age=63072000      ✓ present
vary: rsc, next-router-state-tree, ...
x-powered-by: Next.js                            ✗ leaks framework
(no CSP, X-Content-Type-Options, X-Frame-Options,
 Referrer-Policy, Permissions-Policy)
```

`x-powered-by: Next.js` is set by default; `poweredByHeader: false` in `next.config.ts` will remove it.

### Core Web Vitals — Insufficient data
- Google PageSpeed Insights API was rate-limited at audit time (HTTP 429, default per-day quota = 0 without an API key).
- CrUX field data is unavailable for the origin (insufficient real-user traffic).
- **Code-level signals are good**: `next/font` self-hosts Inter/JetBrains Mono with `display: swap`; two font weights are preloaded; `images.formats` is `['image/avif','image/webp']`; static asset cache is `public, max-age=31536000, immutable`. HTML payload for `/` is ~21 KB.
- **Code-level concerns**: 8+ JS chunks loaded on the homepage; no explicit `<link rel="preload">` for the LCP image (logo lockup). The homepage `cache-control: no-store` (Indexability above) also defeats Vercel's edge cache for the rendered HTML.

---

## 2. Content Quality  (Score: 65)

### E-E-A-T
- **Experience / Expertise**: No author bylines or "about the team" page. No bios linking the operators to data-journalism or housing-law experience. NYC housing data is a YMYL-adjacent domain — adding an "About" page with named operators would strengthen trust.
- **Authoritativeness**: Coverage page is good — names each NYC Open Data source (HPD violations, DOB complaints, evictions, watchlist) and explains refresh cadence. This is excellent E-E-A-T content already.
- **Trust**: `/how-we-make-money` exists and discloses affiliate income — strong trust signal. `/legal/terms`, `/legal/privacy`, `/legal/disclaimer` all exist.
- **Missing**: no `Organization` JSON-LD with founder, address, contact info. Footer says "© 2026 RentGuard NYC LLC" but no `sameAs` links to LinkedIn, Twitter, NY business registry.

### Thin content
| Page | Approx. word count | Verdict |
|---|---|---|
| `/` (homepage) | ~150 words | Acceptable for a tool home; could host 200-400 words of below-the-fold trust copy. |
| `/how-it-works` | ~460 | Good |
| `/coverage` | ~465 | Good |
| `/for-landlords` | ~500 | Good |
| `/pricing` | ~165 | Thin — only the "Free" tier is shown. Comparison framing or FAQ would help. |
| `/how-we-make-money` | ~440 | Good |
| `/building/[bbl]` (sample) | ~370 | OK; varies by data density |

### Duplicate content
- **Critical**: `/` and `/lookup` return byte-identical HTML (same MD5). `/lookup` is implemented as `redirect('/')` server-side but the audit sees the redirected response. Without canonical tags, this is treated by Google as two URLs serving the same content. Combined with both being in the sitemap, this is the single biggest technical-SEO issue.

### Readability
- H1s use clear, benefit-led copy ("Look up any NYC building before you sign", "From a paste to a plain-English risk read"). No jargon issues observed.

---

## 3. On-Page SEO  (Score: 70)

### Titles
| Page | Title | Length |
|---|---|---|
| `/` | RentGuard NYC — Look up any building before you sign | 52 |
| `/how-it-works` | How it works — RentGuard NYC | 28 |
| `/coverage` | Coverage — what data RentGuard checks | 37 |
| `/for-landlords` | For owners and managers — RentGuard NYC | 39 |
| `/pricing` | Pricing — RentGuard NYC | 23 |
| `/how-we-make-money` | How we make money — RentGuard NYC | 33 |
| `/building/4032510071` | Building 4032510071 — RentGuard NYC | 35 |

- All titles are within the 50–60 char ideal except `/pricing` and `/how-it-works`, which are shorter than needed.
- **Building titles use only the BBL number, not the address.** "Building 4032510071 — RentGuard NYC" loses the keyword "85 Greenway Terrace" (or "Forest Hills"). Major missed opportunity. Fix: pass the address from `getBuildingByBbl` into `generateMetadata`.

### Meta descriptions
All present, all 78–170 chars. The `/how-it-works` description is 170 chars — close to the 160 char clip on most SERP layouts; trim by 10–15 chars.

### Heading structure
- Marketing pages: H1 → H3 (no H2). This is a semantic gap. The `<h3>` elements ("What RentGuard does not do", "What we don't cover yet", "How to correct outdated information") should be `<h2>`.
- Pricing has a single H3 ("Free"). Should be H2 wrapping a tier card.
- Building pages: **no H1**. The address renders as H2 ("85 GREENWAY TERRACE, Forest Hills, NY, USA"). Combined with the BBL-only `<title>`, this means search engines see neither the address nor the borough as a top heading.

### Internal linking
- Footer + nav give consistent links to: How it works, Coverage, For landlords, Pricing.
- No internal links from marketing pages to top-ranked example building reports (the "evergreen" indexed building pages are not surfaced from the marketing surface). If you have any building pages with traffic, linking from `/coverage` to "Examples → 85 Greenway Terrace" would push internal PageRank.
- No "see also" / cross-link block on building pages back to `/how-it-works`, `/coverage`, etc.

---

## 4. Schema & Structured Data  (Score: 45)

### Current implementation (only on `/building/[bbl]`)

Two JSON-LD blocks per building page:

```json
{ "@context": "https://schema.org", "@type": "Residence", "name": "...",
  "address": { "@type": "PostalAddress", "streetAddress": "...",
               "addressLocality": "QUEENS", "addressRegion": "NY",
               "addressCountry": "US" } }
```
plus a `Place` entity with score-derived description and identifier=BBL.

### Validation notes
- The `Place.description` is truncated mid-word (`"…before rel"`) at the 200-char cut. Use a hard sentence boundary, not a character slice.
- `addressLocality` is uppercased ("QUEENS"). Schema accepts any case but rich-result previews look better as "Queens".
- No `latitude` / `longitude` / `geo` despite NYC public data exposing this via BBL → BIN → DOB.

### Missing opportunities (priority order)

1. **`Organization` + `WebSite` JSON-LD** in [frontend/app/layout.tsx](frontend/app/layout.tsx) head: legal name "RentGuard NYC LLC", logo, founder, sameAs links, contact email.
2. **`SearchAction` on the homepage** — RentGuard is fundamentally a search box. A `WebSite` with `potentialAction: SearchAction` (target `https://www.rentguard.cc/?q={search_term_string}` or wherever the form posts) makes the site eligible for Google's Sitelinks Searchbox.
3. **`HowTo` schema on `/how-it-works`** — perfect match.
4. **`FAQPage` schema on `/pricing`, `/how-we-make-money`, `/for-landlords`** — these pages already answer common questions in prose; wrapping them in FAQ schema unlocks rich results and AI-answer extraction.
5. **`BreadcrumbList`** on `/building/[bbl]` (`Home › Coverage › Queens › 85 Greenway Terrace`).
6. **`LocalBusiness`** — *not* recommended. RentGuard is a digital tool, not a brick-and-mortar business. Stick with `Organization`.

---

## 5. Performance (CWV)  (Score: 70, estimated)

- **Field data**: unavailable (no CrUX entry; rentguard.cc not yet in the 28-day origin dataset).
- **Lab data**: PSI quota was exhausted at audit time without a paid API key. Re-run from Chrome DevTools Lighthouse or PageSpeed Insights web UI for a live number.

### Code-level review
| Signal | Observation |
|---|---|
| Fonts | Self-hosted via `next/font`, only 3 weights of Inter (400/600/700) + 2 of JetBrains Mono. Two woff2s preloaded. ✓ |
| Images | AVIF + WebP enabled, restricted `deviceSizes`/`imageSizes` arrays. ✓ |
| LCP element | Almost certainly the logo image on every page (preloaded). For `/building/[bbl]` it is the address H2 — text, which is fine. |
| JS | ~8 chunks loaded (`webpack`, `main-app`, `4bd1b696`, `619`, `356`, `255`, `app/layout`, `app/error`). Default Next.js — fine. |
| CSS | One bundled stylesheet `94ba61bda22aec34.css` with `data-precedence="next"`. ✓ |
| CDN cache | **Broken for the HTML itself** (`cache-control: private, no-store` on `/`). Static assets are 1y immutable. |
| Third-party | Cloudflare Web Analytics (`beacon.min.js`) loaded `afterInteractive`. Lightweight. ✓ |
| Supabase preconnect | Conditional `<link rel="preconnect">` to Supabase URL — good. |

### Likely INP / CLS risks
- Building pages render a `BuildingReport` component with multiple data sections (violations, evictions, complaints rows). If these expand on click, ensure no layout shift from late-loading data.
- No reserved width/height for the logo's `next/image` wrapper, but `width=200 height=82` is set via the `<img>` props — should be CLS-safe.

---

## 6. Images  (Score: 85)

- Only 1 `<img>` per fetched page — the logo lockup (200×82, served via `/_next/image`). Has `alt="RentGuard"` (better: `alt="RentGuard NYC logo"` or omit the wrapper `<a aria-label>` and use the visible text).
- AVIF/WebP negotiation enabled at the Next.js layer.
- No hero images, no in-content images, no thumbnails. For SEO this is neutral — there is also no opportunity for image-SERP traffic.
- Building OG image is generated dynamically at `/building/[bbl]/opengraph-image` (1200×630) — perfect.

---

## 7. AI Search Readiness  (Score: 35)

### Crawler access
- `robots.txt` allows all user agents including GPTBot, ClaudeBot, PerplexityBot. ✓
- No explicit `Disallow` for AI crawlers — fine if intent is to be cited; consider rate-limiting AI crawlers in production via the platform layer if cost becomes an issue.

### `llms.txt` — Missing
- `curl https://www.rentguard.cc/llms.txt` → 404. This file is the emerging standard for telling LLMs "here is what this site is about, here is a curated index of canonical pages, here is the data dictionary."
- Suggested skeleton:
  ```
  # RentGuard NYC
  > Free AI-powered building risk lookup for NYC renters,
  > built on NYC Open Data: HPD violations, DOB complaints,
  > marshal evictions, and the Public Advocate's Worst Landlord Watchlist.

  ## Canonical pages
  - [How it works](https://www.rentguard.cc/how-it-works)
  - [Coverage — data sources](https://www.rentguard.cc/coverage)
  - [For landlords](https://www.rentguard.cc/for-landlords)
  - [Pricing](https://www.rentguard.cc/pricing)
  - [How we make money](https://www.rentguard.cc/how-we-make-money)

  ## Data sources
  - HPD Open Violations (NYC.gov, refreshed daily)
  - DOB Complaints (NYC.gov, refreshed weekly)
  - Marshal Evictions (NYC.gov, refreshed weekly)
  - Worst Landlord Watchlist (NYC Public Advocate, annual)
  ...
  ```

### Passage-level citability
- The Coverage page lists sources with cadences and links — **excellent** structure for AI citation. Wrap each source bullet as a `<dl>`/`<dt>`/`<dd>` block or use a real HTML table to make extraction trivial.
- `/how-it-works` describes a 3-step process in prose. Convert to an ordered list with explicit `<ol><li>` markup so LLMs can lift it as a step-by-step.
- `/how-we-make-money` lists "Partners we earn from", "Planned products", "Editorial independence" — clean H3 structure that is already citable. Adding FAQ schema would make these answer-engine-ready.

### Brand mention signals
- No `Organization.sameAs` JSON-LD. AI engines use sameAs to disambiguate "RentGuard" (other companies use this name in the property-insurance space — there is a UK landlord insurance broker called RentGuard). Disambiguation is critical.

### Authority
- Site is on a `.cc` TLD. Not penalizing per se, but `.cc` is used by spam farms; offset by E-E-A-T signals (named LLC, full legal/privacy/disclaimer pages, transparent revenue disclosure).

---

## Crawl Coverage Note

- 8 pages fetched directly. Sitemap inspected programmatically (no full crawl was attempted because of the small surface area — 65 URLs in the sitemap means a deep crawl is unnecessary to characterize the site).
- All marketing pages share the same `<head>` skeleton (layout-driven), so per-page metadata gaps are uniform — fix once in layout/page metadata, ship everywhere.

