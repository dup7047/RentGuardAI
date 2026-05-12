# Analytics Runbook

What we use, where to read it, and how to set it up.

## Cloudflare Web Analytics (deployed in Phase 11.8)

**What:** Privacy-respecting, cookieless analytics. Aggregate page views,
Core Web Vitals, top pages, referrers. No IP storage, no consent banner
needed — matches what `docs/legal/privacy.md` §8 states publicly.

**Dashboard:** <https://dash.cloudflare.com/?to=/:account/web-analytics> →
select the `rentguard.cc` site.

**How to read it:**

| Tab | What it answers |
| --- | --- |
| Overview | Page views, unique visitors, top pages, top referrers |
| Web Vitals | LCP / INP / CLS by page — soft-launch acceptance threshold |
| Loading times | Server response and asset loading by country |

**Day-7 acceptance signal (Phase 14):** dashboard must show ≥1 page view
from a real production visit within 24 hours of deploy. If it does not,
re-check the `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` env var in Vercel and the
beacon script tag at <https://www.rentguard.cc> view-source.

## Setup notes

1. Create a Cloudflare account (free) and add `rentguard.cc` as a Web
   Analytics site (no DNS changes required — JS beacon).
2. Copy the site token. Set `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` in the Vercel
   project env vars (Production + Preview).
3. Beacon is wired in [frontend/app/layout.tsx](../../frontend/app/layout.tsx).
   When the env var is missing, the `<Script>` element is omitted entirely
   — local dev and PR preview builds do not ship a broken beacon.
4. The privacy policy already names the vendor (§8). If you add another
   analytics tool later, update `docs/legal/privacy.md` **before** the new
   tool ships to production.

## What we are NOT using (yet)

- **PostHog** — considered for event-level product analytics but not
  deployed in v7. If/when added, update `docs/legal/privacy.md` §8 to
  name the vendor and disclose what events it captures.
- **Google Analytics 4** — explicitly avoided. Requires consent banner in
  most jurisdictions, ad-cookie default, and conflicts with our "no
  advertising cookies" claim in the privacy policy.

## Backend logs (Render)

Page-view analytics live in Cloudflare; **server-side** logs live in the
Render dashboard for `rentguard-backend`. Errors include a `requestId` that
matches the `X-Request-Id` header returned in the standardized error
envelope (Phase 11.2) — paste a user's `requestId` into Render's log
search to find the matching log line.
