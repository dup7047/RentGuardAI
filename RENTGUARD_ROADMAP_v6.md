# RentGuard NYC → Production Roadmap (v6)

A phased plan for building an AI-powered NYC rental copilot from scratch through public launch and into B2B revenue. The product helps NYC renters avoid bad apartments by analyzing listings, buildings, landlords, and leases against NYC public records and tenant law.

Each chunk is sized for a single focused Claude Code session: clear deliverable, testable in isolation, and structured so earlier chunks keep working as later ones land.

**v3 changes from v2:** stack rewrite to Supabase + Vercel + a thin Node backend on Render free tier. This eliminates ~$30-50/month in fixed costs at zero revenue, collapses Phase 2 (auth) from 4 chunks to 1, and removes redundant infrastructure (R2 → Supabase Storage, custom middleware → RLS, Better Stack → UptimeRobot, Plausible → Cloudflare Web Analytics). Net: ~55-65 sessions instead of 60-75. Year-1 fixed cost: $0/mo until Supabase Pro upgrade is needed (~$25/mo).

**v4 changes from v3:** corrected execution order so Supabase Auth (2.1) ships BEFORE the lookup endpoint referencing authenticated users; fixed the storage-path scheme so anonymous lease uploads work without a user_id (added `anon_token` concept); moved the email-keyed lookup counter off `profiles` (which only exists post-auth) into a dedicated `email_lookup_counters` table; standardized the lease review PDF flow on frontend-direct-to-Supabase-Storage signed URLs (Render free tier can't reliably buffer multi-MB PDFs); switched all crons from "Render cron" (paid) to Supabase pg_cron or external HTTP triggers (free); split Phase 3.10 into real-time-on-first-view rendering and a separate batch regeneration cron (Batch API has up to 24h turnaround, can't be in the user-facing path); replaced DeepSeek V3 in the lease A/B test with an explicit data-residency check (US-hosted models only for lease PII); added Supabase storage-budget note to the cost summary; removed unverified Supabase rate-limit numbers from 2.1; clarified local dev uses Supabase CLI, not bare Postgres.

**v5 changes from v4:** alignment pass against the legal documents (disclaimer language, privacy policy, terms of service draft). Reconciled retention periods to match Privacy Policy §6.1 — lease PDFs 90 days from upload regardless of save, building lookups 12 months, account info 90 days grace after closure, payment records 7 years. Added explicit pre-output framing tasks to Phases 3.9, 4.6, 6.1 to render the disclaimer-doc strings that are the primary UPL mitigation. Added per-lease delete endpoint to Phase 8.6 to honor Privacy Policy §6.2. Added refund eligibility logic to Phase 4.6 to honor ToS §4.3. Added affiliate-disclosure-at-click-through and "How we make money" page tasks (new Phase 8.10). Added per-report "We Are Not" footer to all three report-rendering frontends. Added vendor DPA verification subtask to Phase 0.2 to back the no-training representation in Privacy Policy §4.2. Added PII redaction decision point to Phase 4.3 because Privacy Policy §2.1 acknowledges leases occasionally contain SSNs. Renamed FARE Act output field from `compliant: bool` to `flag: enum` to match disclaimer §3.2 framing ("not a legal determination"). Added NY children's-privacy tracking to Phase 0.1 and the red-flags list. Added a closing "Legal-doc edits required" section flagging the three items where the legal docs need to follow the roadmap's tech choices (password-storage language in Privacy Policy §2.1, analytics-provider naming in §8, anonymous-flow coverage in §2). Net: ~58-68 sessions instead of 55-65.

**v6 changes from v5:** risk-management overlay; no phase-level scope changes. Added a probability-ranked **Risks ranked by probability** section after Product Context, acknowledging that the four most likely failure modes (top-of-funnel, conversion, founder burnout, willingness-to-pay) share a single underlying shape — the consumer-subscription model for NYC renter tooling is structurally hard, and OpenIgloo's August 2025 brokerage pivot is the closest comp signaling that. Replaced **Success metric** with **Success metric and kill criteria** — added explicit 30/60/90/180-day checkpoints with floor metrics and named pivot actions. Added a **Pivot scenarios** section between "Things deliberately NOT included" and "Red flags" describing the two viable pivots (B2B-only, FARE Act-only) plus a wind-down option, each with concrete first-30-day steps. Reframed Phase 7 intro to clarify that warm-up work (CRM, attorney conversations, demo capability) should run in parallel with Phases 3-6 starting at month 4, not be deferred to month 7 — a fast B2B pivot needs warm pipeline, and that takes lead time. Sharpened red-flag triggers with explicit numerical thresholds where they were previously qualitative.

---

## Product context (read before any implementation)

**The problem.** NYC has ~120,000 rental lease signings per year. Renters lose ~$65M/year to rental scams (FTC, Dec 2025). Median scam loss is $400; one in three victims loses >$1,000. Existing solutions are either free-but-clunky (JustFix Who Owns What, NYC HPDOnline), VC-backed and pivoting (OpenIgloo went brokerage in Aug 2025), or low-quality consumer products. There is no AI-native, conversion-optimized, NYC-specific tool for the active renter at the moment of decision.

**The product.** A web app at `rentguard.nyc` that does three things, in order of acquisition value:

1. **Free building lookup**: paste any NYC address (or StreetEasy/Zillow URL with auto-extracted address) → AI risk summary backed by HPD violations, DOB complaints, 311 calls, eviction filings, registered owner via HPD Registrations, NYC Public Advocate Worst Landlord Watchlist status, FARE Act compliance check.
2. **Paid lease review** ($29 one-time): user uploads PDF lease → AI checks against NYC-specific clause library → preview of findings shown free → full report unlocked via Stripe.
3. **Search Pass subscription** ($14.99/mo): unlimited risk reports, 1 lease review/month, saved-building violation alerts, FARE Act compliance auto-check on saved searches.

**The wedges.**
- AI-generated plain-English summary that fits in a screenshot (no incumbent does this)
- FARE Act compliance check (the law took effect June 11, 2025; no incumbent owns this positioning)
- NYC-specific lease gotcha library (ChatGPT can't replicate without per-clause grounding)
- Cleaner UX than government tools, no review-gate (OpenIgloo's #1 review complaint)

**The legal posture.**
- Building/landlord data: surface only verified public-record indicators (HPD violation count, DOB complaint count, eviction filings, watchlist status) with citations to NYC.gov sources. Never generate first-party labels like "slumlord" or "scam."
- Lease review: framed as informational/educational, never advisory. Disclaimer: "This tool surfaces clauses commonly flagged in NYC tenant law. It is not legal advice. Consult a licensed attorney before signing."
- NY SB 7263 (Sen. Gonzalez) is advancing through committee and would create UPL liability for chatbots giving "substantive legal advice." Build the lease tool defensively from day one — never tell users what to do, only explain what clauses mean.

**The monetization.**
- Free: building lookup with AI summary (3/month, gated by email after 1st), basic landlord report, FARE Act compliance check
- Paid one-time: $29 lease review (preview-then-paywall flow)
- Paid recurring: $14.99/mo Search Pass
- Affiliate: Lemonade renters insurance ($25.50/qualified sale via Impact/Awin), Bellhop/Moved movers ($20-50/lead)
- B2B (months 7+): white-label for NYC tenant attorneys at $149-199/mo per firm

**Honest estimate.** ~58-68 focused Claude Code sessions to a real revenue-generating product, with Phase 3 (data integration) and Phase 4 (lease review legal posture) as the biggest unknowns. Plan for ~20 hrs/week of founder time over 8-12 months. Each "session" is 2-4 hours of dedicated work.

---

## Risks ranked by probability

The risks below are ranked by probability of contributing to project failure, not by impact. Items 1–4 share the same underlying shape: **the consumer-subscription business model for NYC renter tooling is structurally hard.** OpenIgloo's August 2025 pivot to brokerage is the closest comparable telling you that. Read this section before assuming the plan executes as written, and revisit it monthly.

1. **Top-of-funnel acquisition fails outright.** TikTok creator-driven distribution is the entire plan. Most consumer products that bet on creator-led acquisition don't get a breakout video — that's the base rate, not pessimism. The SEO play has to compete with Brick Underground, Curbed, JustFix, and the city's own pages, all with years of domain authority. If neither channel produces by day 90, nothing else in the plan matters.
2. **Conversion economics don't pencil out across the funnel.** Even with traffic, the chain (visitor → free lookup → email capture → lease review purchase → Search Pass) has too many leak points. Multiplied conversion rates require huge top-of-funnel volume to reach the $4-8K MRR target. OpenIgloo had brand and traffic; their consumer subscription didn't sustain. That's the closest comp telling you something.
3. **Solo-founder execution drift or burnout.** 58-68 sessions at 20 hrs/week for 8-12 months while also managing legal review, content production, creator oversight, customer support, and (from month 7) outbound sales. Most solo bootstrapped products die here, not from market or technical reasons. By month 6 the founder will be doing four jobs.
4. **Wrong willingness-to-pay at $29 / $14.99.** NYC renters are price-sensitive (the whole premise!) and accustomed to free government tools and free TikTok content. The $14.99/mo subscription depends on someone needing repeated lookups, which most renters don't (apartment hunting is bursty: ~6 weeks every 1-2 years). The price points are reasonable but unproven, and the red-flag triggers below (preview-to-paid below 10%) are exactly where this is likely to land.
5. **OpenIgloo, StreetEasy, or Zillow ships AI summaries / lease analysis.** The wedge ("AI-native, NYC-specific, conversion-optimized") closes the moment any incumbent adds an AI layer to existing traffic. StreetEasy in particular has the data, the traffic, and the engineering to do this in a quarter. Probability rises sharply as RentGuard demonstrates the model works.
6. **Legal action or NY SB 7263 enactment guts the lease review tool.** Product class is squarely targeted: SB 7263 sits in committee specifically targeting this; *DoNotPay* FTC settlement is the obvious precedent. One AG enforcement action ends the company. Probability is moderate over 12 months but rises with growth and visibility.
7. **Defamation demand letter from a named building owner.** The exact §1.3 risk the disclaimer doc flags. NYC has aggressive landlord-side litigation patterns and small companies are attractive targets because they can't fight back. The Worst Landlord Watchlist surfacing is a defamation magnet even though everything is sourced. One letter could force gutting the highest-converting feature.
8. **AI cost overrun from abuse, prompt injection, or provider repricing.** Cost guardrails in 3.7b help but aren't bulletproof. A coordinated abuse campaign or 2x repricing event from OpenAI/Anthropic could flip unit economics negative quietly.
9. **Stripe or another critical vendor deplatforms.** Stripe has deplatformed tenant-rights and legal-adjacent products before. Lower probability, multi-week recovery if it hits.
10. **The FARE Act wedge ages out.** The law took effect June 11, 2025 — almost a year before launch. By the time RentGuard ships, FARE Act compliance may be table-stakes (built into StreetEasy and Zillow listings) rather than a differentiating wedge. The Phase 6 SEO play assumes this hasn't happened.

**Three structural mitigations** (priority order):

1. **Set hard kill criteria at day 90; honor them.** See "Success metric and kill criteria" below. The most common failure mode for solo bootstrapped consumer products isn't a sudden death; it's grinding past the 90-day signal point on hope until founder fatigue makes the pivot impossible.
2. **Run B2B warm-up in parallel with Phases 3-6, not after.** The Phase 7 implementation work waits for product-market signal, but the warm-up — CRM building, attorney conversations, demo capability — should be in motion by month 4-5. A fast B2B pivot needs warm pipeline, and warm pipeline takes lead time. See updated Phase 7 intro.
3. **Consider whether the lease review tool is worth its risk surface.** It's the highest legal exposure (UPL, SB 7263, *DoNotPay* precedent), the most expensive to operate (AI costs, OCR, refunds, support), and depends on the most fragile conversion assumption. A v1 that ships only the building lookup + FARE Act compliance check (no lease review) is faster, lower-risk, and tests the top-of-funnel without committing to the legal-risk surface. If lookup converts, lease review becomes an upsell to an audience that already pays. If lookup doesn't convert, you've saved Phase 4's worth of time and legal complexity. The plan as written keeps lease review; flag this as a real option to revisit at the day-30 checkpoint, not a defeat.

---

## Success metric and kill criteria

Pre-launch success is process-based: **500 free building lookups completed, 25 paid lease reviews sold, and at least 1 TikTok video over 100K views within the first 60 days post-launch**. Below those numbers means either the creator isn't producing virality, the product isn't converting, or the niche isn't responding to faceless content.

Year-1 revenue target: $4-8K MRR by month 12 (P50: $4-5K, P90: $8K+).

**Kill-criteria checkpoints.** Set these before public launch (Phase 10.1) and don't move the goalposts after the fact. Day 0 = first day of public launch.

| Day | Check | Floor | If floor missed |
|---|---|---|---|
| 30 | TikTok creator videos cumulative views | 200K total | Replace creator within 30 days; do not change product. If second creator misses by day 90, distribution itself is the problem — see day 90. |
| 60 | Free building lookup → email conversion | 20% | Iterate AI summary prompt and result page UX before scaling spend |
| 60 | Lease review preview-to-paid conversion | 10% | Test $19 price; adjust preview reveal (try 0 vs 1 vs 2 findings); do not scale paid acquisition |
| 90 | MRR | $1.5K | **Hard checkpoint** — continue, pivot to B2B-only, or pivot to FARE-Act-only (see Pivot scenarios below) |
| 180 | MRR | $3K | If below, the consumer model isn't working at any volume that supports a solo founder. Commit to a pivot or wind down. |

Day 90 missing the $1.5K floor is the hard pivot point. **Continuing past day 120 without a pivot decision is the most common solo-bootstrapped failure mode** — founder fatigue compounds and the optionality to pivot decays. The B2B warm-up running in parallel (see Phase 7 intro) is what makes a fast pivot at day 90 actually possible; without it, the founder is starting from a cold pipeline at exactly the moment they have the least energy for cold outreach.

---

## Where we are vs. where we're going

| Area | Today | Production target |
|---|---|---|
| Auth / identity | None | Supabase Auth magic links |
| Building data | None | Live NYC Open Data API + HPD Registrations + smart caching |
| Landlord lookup | None | HPD-registered owner per BBL; deeper LLC tracing deferred to year 2 |
| AI summary generation | None | gpt-4o-mini structured prompt with citation enforcement + cost guardrails |
| Lease review | None | PDF upload → text extract → preview → paywall → full report |
| FARE Act compliance | None | Auto-check on every listing URL paste |
| Search Pass subscription | None | Stripe subscription with cancel-anytime |
| Email capture | None | Email gate after 1st lookup, weekly newsletter |
| Database | None | Supabase Postgres |
| File storage | None | Supabase Storage |
| Backend (AI pipelines + crons) | None | Thin Hono.js backend on Render free tier |
| Frontend | None | Next.js 15 on Vercel |
| Browser surface | None | Web app first; bookmarklet at month 5; Chrome extension deferred to year 2 |
| Content/distribution | None | Hired TikTok creator producing 12-15 videos/month |
| Tests | None | Unit (data extraction, prompt logic) + integration (auth, lease purchase) |
| Observability | None | Pino structured logs, Sentry (added month 3), UptimeRobot, OpenAI cost tracking |
| Legal posture | None | NY internet/media law attorney consult complete; disclaimers vetted |
| B2B pipeline | None | Warm: 50+ NYC tenant attorneys in CRM by month 5; demo-ready Loom by month 6 |

---

## Tooling decisions (cost-optimized for solo bootstrap)

- **Frontend framework:** Next.js 15 (App Router) on Vercel. SSR for SEO landing pages, RSC for fast first paint. Vercel Hobby tier (gray-area for commercial; switch to Cloudflare Pages if Vercel ToS becomes a concern).
- **Database + auth + storage:** Supabase. Free tier (500MB Postgres, 1GB storage, 50K MAU) covers the first 6+ months. Pro tier ($25/mo) when you cross those limits.
- **Schema + migrations:** Drizzle ORM, pointed at the Supabase Postgres connection string. Keeps schema portable, type-safe, and version-controlled. Supabase Studio is for reads/exploration; migrations live in code.
- **Backend (AI pipelines, crons, webhooks):** Hono.js on Render free tier (spin-down web service, accepts cold starts at zero revenue). Lightweight TypeScript framework, similar API to Fastify but better serverless support. Graduate to Render's $7/mo "Starter" plan when revenue justifies always-on.
- **AI provider (building summaries):** OpenAI gpt-4o-mini. ~$0.0014 per summary. Use Batch API for non-real-time SEO archive generation (50% cost reduction).
- **AI provider (lease review):** A/B test in Phase 4.3 between gpt-4o-mini, gpt-4o, Claude Sonnet 3.5, and Claude Haiku 3.5. Pick the cheapest model that catches ≥3 of 5 known issues per lease. **Hard constraint: US-hosted models only — lease PDFs contain user PII and the choice affects the privacy policy + B2B contracts.**
- **Anthropic Claude Haiku 3.5** as the cheap default for the lease review pipeline (likely A/B winner; verify on the actual eval).
- **PDF text extraction:** `pdf-parse` (server-side), with Tesseract.js OCR fallback for scanned-image leases.
- **PDF generation:** `pdfkit` for the DCWP complaint letter (Phase 6.2). `@react-pdf/renderer` only for B2B branded reports in Phase 7.2 where layout flexibility matters.
- **Validation:** zod for all API endpoints + form inputs.
- **Auth:** Supabase Auth, magic links via email. No social login in v1.
- **Payments:** Stripe Checkout (one-time + subscription). Customer Portal for self-serve cancel.
- **Email transactional:** Resend free tier (3,000 emails/month).
- **Email newsletter:** Beehiiv free tier (up to 2,500 subscribers). Separate from transactional to avoid Resend Marketing pricing.
- **Page analytics:** Cloudflare Web Analytics. Free, privacy-friendly, no cookie banner needed.
- **Event analytics:** PostHog free tier (1M events/month). Events only — page views handled by Cloudflare. Fire events on paid funnel actions, not on every interaction.
- **Error reporting:** Sentry free tier (5K errors/month). **Add at month 3 only**, not from launch — pre-launch errors are not actionable.
- **Uptime monitoring:** UptimeRobot free tier (50 monitors at 5-min intervals).
- **Object storage:** Supabase Storage (1GB free). Use for lease PDF uploads and B2B firm logos.
- **Search/SEO:** Static landing pages per NYC neighborhood + per landlord registered-owner-name (auto-generated via Next.js ISR, indexed by Google).

**Year-1 fixed-cost monthly burn at zero traffic: $0/mo for the first ~6 months, then ~$25/mo (Supabase Pro) when you cross free-tier limits.**

---

## Phase 0 — Prerequisites (admin, runs in background)

These don't unblock day-one chunks but gate later ones. Start them now.

**0.1 — NY internet/media law attorney consultation**
Book and pay for a 60-90 min call ($500-800). Bring specific questions: UPL boundary on lease tool (what wording crosses the line?), defamation exposure on landlord risk indicators, NY SB 7263 status and contingency language, FARE Act product positioning, terms-of-service template for `/legal/terms`, privacy policy template for `/legal/privacy`, **applicability of NY SAFE for Kids Act and NY Child Data Protection Act to a general-audience product (effective dates and triggers)**, **enforceability of the limitation-of-liability cap and arbitration clause against NY consumers**, **CPRA "sharing" analysis on affiliate links and analytics**, and **whether `Casper Sleep v. Mitcham` requires structural separation between affiliate revenue and risk-indicator publishing or whether disclosure-at-click-through is sufficient**. Get the master disclaimer language drafted in writing.
**Gates:** Phase 4 (lease review tool ships only after legal sign-off), Phase 7 (B2B contracts).
**Acceptance:** signed engagement letter; written disclaimer language saved to `docs/legal/disclaimers.md`; one-page memo on UPL boundary saved to `docs/legal/upl-boundary.md`; one-page memo on children's-privacy applicability saved to `docs/legal/childrens-privacy.md`.

**0.2 — Provision Supabase, Vercel, Render, Cloudflare; verify AI-vendor DPAs**
Create accounts and link the domain:
- **Supabase:** create one project for staging, one for prod. Note the connection strings, anon key, service role key. Enable email auth provider.
- **Vercel:** create project for the Next.js frontend. Link GitHub repo.
- **Render:** create a free-tier Node web service for the backend. Will deploy in Phase 1.1.
- **Cloudflare:** add the domain, enable Web Analytics, configure DNS to point to Vercel.

**Verify AI-vendor data-handling agreements** (this backs the no-training representation in Privacy Policy §4.2; without it, the policy is making a claim you haven't confirmed):
- **OpenAI:** confirm API org settings exclude inputs/outputs from training (default for API since March 2023, but verify in the org dashboard); enable zero data retention if eligible, otherwise document the standard 30-day retention.
- **Anthropic:** confirm the standard commercial terms specify no training on customer data and document the data retention window from the Anthropic Trust Center.
- Save screenshots/links to `docs/legal/vendor-dpa.md` for the privacy-policy attorney review.

Create `frontend/.env.example` and `backend/.env.example` with: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` (fallback), `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `NYC_OPEN_DATA_APP_TOKEN`. (DeepSeek key removed in v4 — US-hosted models only for lease PII.) Document where each secret is stored (Vercel/Render env vars; never committed).
**Acceptance:** all five accounts created; staging and prod Supabase projects exist; `vercel deploy` deploys a hello-world Next.js to the staging Vercel URL; Render free-tier service deploys a hello-world Hono app at staging URL; Cloudflare Web Analytics tag is firing on the Vercel deployment; `docs/legal/vendor-dpa.md` exists with confirmed no-training posture for both AI providers.

**0.3 — NYC Open Data API token + data source inventory**
Register for a free NYC Open Data app token (raises rate limit from 1k/hr to 10k/hr). Document every Socrata endpoint we depend on (HPD Violations, HPD Registrations, HPD Registration Contacts, DOB Complaints, 311 Housing Complaints, NYC Marshal Evictions, Bedbug Registry, Lead Paint History) with refresh cadence and field-name reference. Save to `docs/data-sources.md`.
**Acceptance:** `curl https://data.cityofnewyork.us/resource/... -H "X-App-Token: ..."` succeeds for each documented endpoint; `docs/data-sources.md` lists every endpoint, its primary key, and its refresh cadence.

**0.4 — Stripe account + product setup**
Stripe account in test mode. Create products: "Lease Review" ($29 one-time), "Search Pass Monthly" ($14.99/mo). Create a Customer Portal config that allows self-serve cancellation. Webhook endpoint registered (will point to backend once 1.x ships).
**Acceptance:** Stripe Checkout URL works in test mode; canceling a test subscription via Customer Portal fires the expected webhook; secrets are in Render env vars, not committed.

**0.5 — TikTok creator recruitment**
Send 30-50 outreach DMs to NYC apartment-content TikTok creators in the 10K-100K follower range. Offer: $1,500-2,500/month for 12-15 videos, paid trial month, content rights to repurpose on Instagram Reels and YouTube Shorts. Look for: native NYer, has done apartment-tour or moving content, comfortable on camera with a script, at least one organic 100K+ view video. Run 5-7 calls. Pick one.
**Acceptance:** signed creator contract; first 5 video scripts written by you (founder); first shoot scheduled.

**0.6 — Domain + brand**
Register `rentguard.nyc` (or final chosen domain). Set up Google Workspace email. Reserve handles on Twitter/X, TikTok, Instagram, LinkedIn. Create a 1-page Carrd/Framer landing site with email capture: "Free NYC building risk lookup. Coming soon." Use Beehiiv signup form embed for the email capture (sets up newsletter early).
**Acceptance:** landing page live; Beehiiv list created with welcome email automation; Cloudflare Web Analytics firing.

---

## Phase 1 — Foundation (no entitlements; do first)

**1.1 — Backend scaffold (Hono on Render)**
Bootstrap `backend/` with Hono.js, pino, TypeScript strict mode, dotenv. Single `/health` endpoint that returns `{status: "ok", commit: <git sha>}`. Pino logs include method/path/duration/requestId per request. Deploy to Render free tier; expect cold start of ~30 sec on first request after idle.
**Acceptance:** `npm test` passes (one smoke test for `/health`); `curl <render-url>/health` returns 200; logs are JSON-structured with requestId; cold start tolerated by frontend.

**1.2 — Drizzle setup against Supabase Postgres + Supabase CLI for local dev**
Add Drizzle, `pg`, and `npm run migrate` script. Single empty migration proving the toolchain works.

For local development, use the Supabase CLI (`supabase init` + `supabase start`) which spins up a local Supabase stack including Postgres with the `auth.*` schema pre-populated. **Do NOT use a bare `docker-compose.yml` with raw Postgres** — Drizzle migrations that reference `auth.users` won't apply, and you'll waste a session debugging schema mismatches.

**Acceptance:** `supabase start` brings up local stack; `npm run migrate` applies schema to local Supabase; same `npm run migrate` against staging Supabase succeeds; CI runs the migration flow against a Supabase CLI instance on every PR.

**1.3 — Schema: profiles, email_lookup_counters, building_lookups, lease_reviews + RLS policies**
Supabase auto-creates `auth.users`. Define + migrate via Drizzle:

- `profiles` (id matches auth.users.id, email, stripe_customer_id nullable, deletion_requested_at timestamp nullable, created_at) — only created at first authentication. `deletion_requested_at` supports the 90-day account grace from Privacy Policy §6.1, implemented in Phase 8.6.
- `email_lookup_counters` (email primary key, count_30d int default 0, reset_at timestamp, anon_token uuid for anonymous-session continuity) — tracks the free-tier counter for users identified only by email, BEFORE any auth happens. When a user later signs in, a backend job copies their counter state into `profiles` and the email_lookup_counters row is deleted.
- `building_lookups` (id, user_id nullable, email nullable, anon_token uuid nullable, address_input, building_bbl FK nullable, ai_summary text, ai_cost_cents int, created_at) — `anon_token` lets us link multiple anonymous lookups from the same browser session even before email is given. Per Privacy Policy §6.1, retained 12 months then auto-purged (cron in Phase 8.7).
- `lease_reviews` (id, user_id nullable, anon_token uuid nullable, email nullable, stripe_payment_intent_id nullable, pdf_storage_path nullable, extracted_text nullable, ai_report jsonb, ai_cost_cents int, status enum, preview_only boolean default true, first_viewed_at timestamp nullable, pdf_deleted_at timestamp nullable, created_at) — anonymous users can do a lease preview using anon_token + email; full unlock requires payment which captures email, then optionally upgrades to a full account. `first_viewed_at` is set when the user first loads the unlocked report URL (used by Phase 4.6b refund logic). `pdf_deleted_at` records when the underlying PDF was purged (either by the 90-day cron from Privacy Policy §6.1 or by the user's explicit delete from Phase 8.6); `pdf_storage_path` and `extracted_text` are nulled at the same time but the structured `ai_report` summary is retained while the account is active.

**RLS policies (critical, do not skip):**
- `profiles`: users can read/update their own row only; service role full access.
- `email_lookup_counters`: service role only (writes go through backend, never queried from client).
- `building_lookups`: anyone can insert (service role does the actual insert via backend); authenticated users can read rows where `user_id = auth.uid()`; anonymous users read via the result-page's signed slug, not via direct query; service role full access.
- `lease_reviews`: authenticated users read where `user_id = auth.uid()`; anonymous users access via the post-payment success-page paywall_token, not via direct query; insert/update restricted to service role.

**Acceptance:** schema applied via Drizzle to staging Supabase; RLS enabled on all tables; manual test via Supabase Studio confirms a user cannot read another user's lookups via the anon key; manual test confirms the anon-token-based read of a building_lookup result requires the slug, not the row id; nulling `pdf_storage_path` and `extracted_text` while retaining `ai_report` works as intended.

**1.4 — Schema: buildings, landlords (cache layer)**
Cache tables: `buildings` (bbl as primary key, address, borough, last_fetched_at, raw_data jsonb), `landlords` (id, registered_owner_name, hpd_corporation_name, watchlist_rank nullable, last_fetched_at). RLS: read-only public access; writes restricted to service role. These are public reference data, so RLS is permissive on read.
**Acceptance:** schema migrated; anon key can read from `buildings` and `landlords`; only service role can write.

**1.5 — Schema: subscriptions, affiliate_clicks, ai_usage, non_nyc_waitlist, refunds**
`subscriptions` (id, user_id FK, stripe_subscription_id, status enum, current_period_end, created_at). `affiliate_clicks` (id, user_id nullable, anon_token uuid nullable, partner enum [lemonade, bellhop, moved], referrer_url, clicked_modal_at timestamp, clicked_through_at timestamp nullable, converted_at nullable, commission_amount_cents nullable) — `clicked_modal_at` records when the user opens the disclosure modal from Phase 8.10; `clicked_through_at` records whether they then proceeded to the partner site. `ai_usage` (id, user_id nullable, email nullable, route enum [lookup, lease_preview, lease_full], cost_cents int, model_used text, created_at) — used by the cost monitor in 3.7b. `non_nyc_waitlist` (id, email, attempted_address, requested_city, requested_state, created_at). `refunds` (id, user_id nullable, lease_review_id nullable, subscription_id nullable, stripe_refund_id, amount_cents, eligibility_reason text, created_at) — populated by Phase 4.6b refund logic; survives account deletion with `user_id` nulled per Privacy Policy §6.1 (7-year retention).

**RLS:**
- `subscriptions`: users can read their own row; service role full access (Stripe webhook writes here).
- `affiliate_clicks`, `ai_usage`, `non_nyc_waitlist`, `refunds`: service role only.

**Acceptance:** migrations apply; can record an affiliate modal click and a subsequent click-through and conversion; AI usage row written on every model call; non-NYC paste captures email + attempted city; refund row writeable by service role and survives a synthetic account deletion with `user_id = NULL`.

**1.6 — Supabase Storage buckets + policies**
Create two Storage buckets: `lease-pdfs` (private — service role can read/write all; users can read only their own files) and `firm-logos` (public read for B2B in Phase 7). Define storage policies.

Path conventions:
- Authenticated user lease: `lease-pdfs/{user_id}/{lease_review_id}.pdf`
- Anonymous user lease: `lease-pdfs/anon/{anon_token}/{lease_review_id}.pdf` (the `anon_token` from `lease_reviews` row)
- Firm logos: `firm-logos/{org_id}/logo.png`

Storage RLS policy on `lease-pdfs`: SELECT allowed when `(auth.uid()::text = (storage.foldername(name))[1])` OR via signed URL with valid `paywall_token`. INSERT allowed via signed upload URL only (issued by backend). Service role bypasses RLS.

**Acceptance:** uploading a PDF as user A and trying to read it as user B fails; same upload readable by service role; signed-URL read works for both authenticated and anonymous flows; firm-logos bucket allows public reads.

**1.7 — Backup verification**
Supabase free tier offers daily snapshots; Pro tier offers point-in-time recovery. Document restore procedure in `backend/RUNBOOK.md`. Actually run a restore from a snapshot to a fresh Supabase project (this catches surprises).
**Acceptance:** runbook complete; restore from snapshot to scratch project completes successfully and runbook updated with any clarifications.

---

## Phase 2 — Identity (depends on Phase 1)

**2.1 — Configure Supabase Auth + Next.js client integration**
Configure Supabase Auth in dashboard: email magic link enabled, custom email template using Resend SMTP credentials (Supabase routes auth emails through your provider so they look branded). On the Next.js frontend, install `@supabase/ssr` for server-component-friendly auth. Pages: `/` (landing), `/login` (email input → calls `supabase.auth.signInWithOtp()` → "check your email"), `/auth/callback` (handles the magic link redirect, sets cookie, redirects to `/dashboard`). HTTP-only cookies via `@supabase/ssr` middleware.

Supabase Auth has built-in rate limiting on `signInWithOtp`. The exact limits are subject to change; verify the current values in the Supabase dashboard and document them in `docs/runbook/auth-limits.md` so they can be tuned if abused. Do NOT add custom rate limiting on top in v1 — adding two rate limiters increases support load (users hitting the wrong one see different errors).

**Acceptance:** end-to-end manual test on staging: enter email → receive Resend-routed email branded as RentGuard → click link → land on dashboard with session; logout clears the session; visiting `/dashboard` without auth redirects to `/login`; current Supabase rate-limit config documented in `docs/runbook/auth-limits.md`.

---

## Phase 3 — Free building lookup (depends on Phase 1 + Phase 2.1)

This is the entire top-of-funnel. It works for both anonymous (anon_token + email) and authenticated users. Phase 2.1 (Supabase Auth) ships before this phase so the authenticated branch in 3.8 has real users to test against.

**3.1 — NYC Open Data client library**
Module `backend/src/data/nyc.ts` with typed clients for HPD violations, HPD Registrations + Contacts (registered owner per BBL), DOB complaints, 311 housing complaints, evictions (executed marshal data), bedbug registry, lead paint history. Each function takes a BBL or address and returns parsed data. Cache responses in `buildings.raw_data` (Supabase Postgres) for 24 hours per source.
**Acceptance:** unit tests with mocked Socrata responses; integration test against live API for one known building (e.g. 350 5th Ave) returns expected violation count and registered owner name.

**3.2 — Address geocoding to BBL with non-NYC capture**
Use NYC's GeoSearch API (`https://geosearch.planninglabs.nyc`) to convert any address input → BBL. Handle three cases: (a) clean NYC match → return BBL; (b) ambiguous NYC address (e.g. "123 Main St" with no borough) → return all matches and ask user to pick; (c) non-NYC address → return `{outside_nyc: true, detected_city, detected_state}` so the frontend can capture email for `non_nyc_waitlist`.
**Acceptance:** integration test: "350 5th Ave" returns Empire State Building's BBL; ambiguous "123 Main St" returns multiple matches with borough; "1600 Pennsylvania Ave Washington DC" returns the outside_nyc payload.

**3.3 — StreetEasy/Zillow URL parser with graceful degradation**
Module that takes a StreetEasy or Zillow URL and attempts to extract address. Three outcomes: (a) URL contains a parseable address slug → extract directly; (b) URL contains an opaque building/listing ID → return `{requires_address: true}`; (c) unrecognized URL pattern → same fallback as (b). Never scrape; never call portal APIs.
**Acceptance:** unit tests for each case across StreetEasy + Zillow + Apartments.com URL patterns; (b) and (c) return `{requires_address: true}` with friendly message; no test attempts to fetch the URL.

**3.4 — HPD Registered Owner lookup**
Module that, given a BBL, queries HPD Registrations and HPD Registration Contacts (NYC Open Data) and returns: `{registered_owner_name, registration_id, head_officer_name, head_officer_business_address, last_registration_date}`. Cache in `landlords` table for 7 days. **Year-2 expansion** (NOT this phase): join with ACRIS deeds + DOB BIS records for portfolio tracing across LLCs.
**Acceptance:** integration test: known building's BBL returns the registered owner; querying same BBL twice within 7 days hits cache; non-registered BBLs return `{registered_owner_name: null, ...}` cleanly.

**3.5 — Worst Landlord Watchlist scraper**
Once-per-month script (run manually for V1; cron in 8.x) that downloads the published Public Advocate Worst Landlord Watchlist and updates `landlords.watchlist_rank` for matched registered-owner names. Match by normalized name string (lowercase, strip "LLC", strip punctuation).
**Acceptance:** running `npm run import-watchlist` updates rank for known watchlist entries; unmatched landlords are unchanged.

**3.6 — FARE Act compliance check**
Pure function: given a listing URL parsed in 3.3 and a parsed listing description (passed in by client paste), detect whether broker fees are mentioned in violation of the FARE Act. Returns `{flag: 'no_indicators' | 'possible_violation' | 'unclear', indicators: string[], explanation: string}`.

**Why `flag` and not `compliant: bool`:** disclaimer §3.2 is explicit that DCWP, not RentGuard, decides FARE Act violations. A field literally named `compliant: false` overshoots that framing. The enum values are descriptive of what the check observed, not legally determinative. Conservative default: if uncertain, returns `{flag: 'unclear', ...}`.

**Acceptance:** unit tests for: clean listing (`flag: 'no_indicators'`), listing mentioning "tenant pays broker fee" on landlord-listed unit (`flag: 'possible_violation'`), ambiguous listing (`flag: 'unclear'`).

**3.7 — AI summary generation**
Module that takes the assembled building report and generates a 100-word plain-English risk summary using gpt-4o-mini. System prompt enforces, per disclaimer §1.3:

- cite source counts ("47 open HPD violations" not "many violations")
- no first-party scam labels and no characterizations of the building, owner, or manager beyond what the public records literally say
- the summary is "not a verdict" on the building, owner, or manager and "not advice about whether to rent here"
- end with "always check the cited records yourself before relying on anything in this summary"

Output: `{summary: string, indicators: {key: string, value: string, source_url: string}[]}`. Every call writes a row to `ai_usage` table with cost.

The pre-output framing string from disclaimer §1.3 is rendered separately by the frontend (Phase 3.9) above the AI summary; the prompt does not need to reproduce it.

**Acceptance:** unit tests with mocked OpenAI responses; manual eval on 10 known buildings shows summaries that are accurate, non-defamatory, and screenshot-friendly; spot-check confirms no summary uses verdict language ("bad," "scam," "slumlord," "avoid"); `ai_usage` row exists for every call with non-zero cost_cents.

**3.7b — AI cost guardrails (BEFORE first public traffic)**
Per-user/per-email/per-anon-token daily cost caps enforced at the route layer. Free anonymous: $0.20/day cost ceiling per email or anon_token (~50 lookups). Free authenticated: $0.50/day. Search Pass: $5/day. Hitting cap returns friendly error, not 429. Per-request: hard cap of 4K input + 1K output tokens on the lookup route.

Daily aggregation runs via Supabase pg_cron (free, included in all tiers): `SELECT cron.schedule(...)` to run a SQL function nightly that flags any user/email with >$5 in `ai_usage` for the previous 30 days. Flagged entries written to a `cost_alerts` table (service-role-only) which the founder reviews via Supabase Studio.

**Acceptance:** simulated abusive caller hits cap and is blocked with clear message; legitimate user never hits cap in normal use; pg_cron job runs successfully on staging; aggregation flags a synthetic over-cost user within 24h.

**3.8 — Backend endpoint: `POST /v1/lookup`**
Accepts `{address?: string, listingUrl?: string, email?: string, anon_token?: string, listingDescription?: string}`. If `listingUrl` provided, parses to address (3.3); if `requires_address: true`, returns that to client. If non-NYC (3.2), captures email to `non_nyc_waitlist` and returns waitlist payload. Otherwise: geocodes → pulls + caches building data → pulls owner data → runs FARE Act check (only if listingUrl) → checks counter on `email_lookup_counters` (1 free without email, 3 free total per email per 30 days) → enforces AI cost cap → generates AI summary → stores `building_lookups` row (with anon_token if no email yet).

Rate limit: 10/hr per anon_token without email, 30/hr per email, 60/hr per authenticated user_id. **All endpoints prefixed `/v1/`.**

Note: rate limiting on Render free tier needs to be implemented in-process (Hono middleware) since Render doesn't provide built-in rate limiting. Use a sliding-window in-memory store; this is fine for v1 single-instance deploy. Caveat: when Render restarts the instance (which happens on each deploy and after ~15min of idle), in-memory counters reset — this is acceptable v1 because Render free tier is single-instance and deploys are infrequent.

The "60/hr authenticated" path is dead code until Phase 2.1 ships. Phase 3 launches anonymous-only; auth wires in immediately after 2.1.

**Acceptance:** end-to-end integration test: POST with real address returns structured report in <8s (cold cache); same request returns in <500ms (cache hit); 11th unauthenticated request from same anon_token returns 429; 4th lookup from same email returns 402; non-NYC paste returns waitlist payload.

**3.9 — Frontend: building lookup page**
`/lookup` page with single input (address or URL), submit button, loading state with progress indicators, result page rendering the AI summary + structured indicators + linked sources. Email-gate: free first 1 lookup without email, second requires email capture (added to Beehiiv list via Supabase function). Result page is shareable with unique slug like `/lookup/abc123` and Open Graph image. **Non-NYC handling:** if API returns waitlist payload, show "We're NYC-only for now — drop your email and we'll let you know when [city] launches" and post to waitlist.

**Mandatory legal-content blocks** (from `docs/legal/disclaimers.md`):

- **Pre-output framing** — render disclaimer §1.3 verbatim ("The summary below was written by an AI model from public records…") *above* the AI-generated summary. This is a static string read from the disclaimers file at build time; never AI-generated.
- **Footer "We Are Not" block** — render disclaimer §5 verbatim at the bottom of every result page (we are not a law firm, broker, advocacy org, etc.).
- **Affiliate disclosure at click-through** — when the user clicks an affiliate CTA on this page (e.g., a Lemonade renters-insurance link), interstitial or inline disclosure from disclaimer §4.1 ("RentGuard NYC earns a commission if you purchase through this link…") renders before the redirect. Click is logged to `affiliate_clicks` regardless of whether the user proceeds.

These blocks are loaded from a single source (`docs/legal/disclaimers.md` parsed into a JSON file at build time and imported by the frontend) so a one-line attorney edit propagates everywhere without code changes.

**Acceptance:** manual test on 5 different NYC addresses; email gate fires after first lookup; shared URL renders correctly in incognito; OG image renders on Twitter/X; non-NYC paste captures email to waitlist; pre-output framing string is byte-identical to disclaimer §1.3 (snapshot test); footer matches disclaimer §5 (snapshot test); affiliate click-through shows disclosure and logs the click.

**3.10 — Frontend: building lookup public archive (SEO)**
Every completed lookup creates an indexable `/building/[bbl]` page rendered server-side via Next.js with ISR (incremental static regeneration), 24-hour revalidation. Sitemap.xml lists all known BBLs (dynamic, generated from the `buildings` table on each request, cached). `robots.txt` allows indexing. Schema.org structured data per page.

**SEO summary generation:** the AI summary on the page comes from the same real-time gpt-4o-mini call as Phase 3.7 — the user-facing lookup and the SEO page share one summary per BBL. No batch API in this user-facing path (Batch has up to 24h turnaround and can't block a page render).

**Phase 3.10b (separate, optional, NOT REQUIRED FOR LAUNCH):** a periodic refresh cron (Supabase pg_cron, monthly) that uses the OpenAI Batch API at 50% cost to regenerate AI summaries for buildings whose underlying violation data has changed. Skip this until you have ≥1000 indexed buildings and the cost saving justifies the build.

**Acceptance:** new lookup → page reachable at canonical URL; sitemap.xml updated within 1 hour; Google Search Console fetches it without error; structured data validates in Google's Rich Results test.

---

## Phase 4 — Lease review tool (depends on Phase 1, 2, 3 + Phase 0.1 legal sign-off)

**4.1a — NYC lease clause library: initial 5 high-confidence entries**
Hand-curated YAML library at `backend/src/lease/clauses.yml` covering ONLY the highest-confidence violations to start: HSTPA 2019 security deposit (no more than 1 month's rent), FARE Act broker fee on landlord-listed unit, illegal late fees (>$50 or >5% of rent, whichever is less), Bedbug Disclosure Form requirement (Local Law 69 of 2017), Lead Paint Disclosure for buildings pre-1960 with children under 6. Each entry: id, name, description, why-it-matters, NY law citation, severity (high/medium/low), example violation patterns.

**Disclaimer-doc alignment:** disclaimer §2.2 currently advertises rent-stabilization-misrepresentation and pet-policy/service-animal coverage, which are in 4.1b (not 4.1a). At the v1 launch (4.1a only) the disclaimer in production must be a **v1 variant** that lists only the five clauses actually shipped. After 4.1b lands, swap to the full disclaimer-§2.2 language. Track as a launch-blocker checklist item: do not push 4.1a to production with the 4.1b-era disclaimer text.

**Acceptance:** `clauses.yml` validates against zod schema; 5 entries; manual review by attorney from 0.1 confirms accuracy; library exported as TypeScript module for use in pipeline; v1-variant disclaimer string saved at `docs/legal/disclaimers-v1.md` and approved by attorney; the frontend (Phase 4.6) is wired to read the v1 variant until 4.1b ships, then swaps to the full §2.2 string.

**4.1b — NYC lease clause library: expansion to 15+ (after attorney sign-off on 4.1a)**
After 4.1a is reviewed and shipped, expand to: J-51 tax abatement disclosure, Roommate Law (illegal "no roommates" clauses), illegal lease termination clauses, illegal pet bans where service animals are protected, illegal automatic renewal terms, illegal waiver of warranty of habitability, rent stabilization misrepresentation indicators, illegal subletting prohibitions on rent-stabilized units, illegal forfeiture-of-security-deposit clauses, illegal "as-is" condition clauses.
**Acceptance:** 15+ entries; attorney review of additions; updated tests.

**4.2 — PDF text extraction**
Module that takes a PDF buffer and returns extracted text. Uses `pdf-parse` first, falls back to Tesseract.js OCR if extracted text is <500 chars (likely scanned image). Handles multi-page PDFs by concatenating with page markers. Rejects encrypted/password-locked PDFs with a clear error. **Note:** Tesseract.js OCR can take 5-15s on a 4-page lease — fine for a paid one-off action but allow for the timeout in the upload UI.
**Acceptance:** unit tests on 5 sample leases (typed, scanned, mixed, encrypted-rejected, password-locked-rejected).

**4.3 — AI lease review pipeline (with provider A/B test)**
Takes extracted lease text + clause library, runs structured LLM call with strict output schema: `{clauses_found: [{clause_id, severity, location_in_lease, excerpt, explanation}], overall_summary, disclaimer}`. System prompt enforces, per disclaimer §2.2 and §2.3:

- never give legal advice and never tell the user what to sign, demand, refuse, or do
- only explain what clauses appear to say and which NY laws they relate to
- never characterize the landlord's intent or motivation
- include the citation to the NY statute or regulation for every clause flagged
- the `disclaimer` field on the output is the v1 disclaimer string from `docs/legal/disclaimers-v1.md` (until 4.1b ships) or §2.2 of the disclaimer doc (after 4.1b)

**PII handling on lease text** (Privacy Policy §2.1 acknowledges leases occasionally contain SSNs and government-issued ID numbers): the lease text sent to the AI provider may contain SSNs. Two options — pick one and document the decision in `docs/legal/pii-handling.md`:

1. **Redact-before-send (defensible default).** Run a regex pass on extracted text to redact 9-digit SSN-shaped numbers, 9-digit ITIN-shaped numbers, and common driver's-license patterns before the prompt is constructed. Track redactions in the report (e.g., "[REDACTED IDENTIFIER] appears in §12 of your lease — we did not send this to the AI model").
2. **Send-as-is, rely on vendor DPA.** Acceptable only if the vendor DPA from Phase 0.2 explicitly covers SSN/PII processing and the privacy policy (§2.1, §4) is updated to disclose this clearly.

Recommendation: ship redact-before-send for v1. It's a 1-hour add and removes a real liability surface.

**Provider A/B test (do this once, pick winner). Hard constraint: lease PDFs contain user PII (name, address, sometimes income, occasionally SSNs) and the choice of provider affects the privacy policy and B2B contracts in Phase 7. Use US-hosted, established providers only.** Eligible candidates: gpt-4o-mini, gpt-4o, Claude Sonnet 3.5, Claude Haiku 3.5. **Excluded:** DeepSeek (China-hosted; data residency concern for legal documents); any open-weight model running on shared inference services without a clear data-handling agreement.

Run the pipeline through gpt-4o-mini, gpt-4o, Claude Sonnet 3.5, and Claude Haiku 3.5 against your 5-lease eval set. Score: (a) catches ≥3 of 5 known issues per lease, (b) never recommends specific action (never crosses UPL line), (c) cost per review. Pick the cheapest model that passes (a) and (b). At current pricing (May 2026), Claude Haiku 3.5 ($0.80/M in + $4/M out) is likely the cheapest US-hosted option that passes the structured-reasoning bar — verify on the actual eval before committing.

**If the winning provider is not Claude Haiku 3.5:** update Privacy Policy §4.1 (currently names "Claude Haiku 3.5 or a comparable US-hosted model from Anthropic") to reflect the actual model in production. Privacy policy and product must match at launch.

**Two modes:** `preview` (returns top 1-2 highest-severity findings + count of additional findings, redacts excerpt locations) and `full` (returns complete report). Every call writes to `ai_usage` with `model_used` populated.

**Acceptance:** unit tests with mocked LLM; provider A/B results documented in `docs/llm-eval.md` with selection rationale, cost-per-review, and explicit data-residency check; PII redaction decision documented in `docs/legal/pii-handling.md`; manual eval on 5 real anonymized leases — chosen model catches at least 3 of 5 known issues per lease, never recommends a specific action; preview mode returns fewer than full mode; both modes write usage rows; redaction unit test confirms SSN-shaped strings are stripped before prompt construction.

**4.4 — Backend endpoint: `POST /v1/lease-review/preview`**
Two-step flow:

1. **Step A (issue signed upload URL)**: `POST /v1/lease-review/upload-url` accepts `{email, anon_token?}`. Validates rate limit (1 preview per email per 24 hours). Creates a `lease_reviews` row with `status: 'pending_upload'`. Returns a Supabase Storage signed upload URL valid for 5 minutes + the new `lease_review_id`. Storage path is `lease-pdfs/{user_id}/{lease_review_id}.pdf` for authenticated users or `lease-pdfs/anon/{anon_token}/{lease_review_id}.pdf` for anonymous.
2. **Step B (frontend uploads PDF directly to Supabase Storage using the signed URL)** — the PDF never passes through the Render backend. This is critical: Render free tier has 512MB memory and may OOM on 10+MB scanned-image PDFs.
3. **Step C (process)**: `POST /v1/lease-review/process` accepts `{lease_review_id}`. Verifies the PDF was actually uploaded (Supabase Storage HEAD check). Backend downloads the PDF from Storage, extracts text, runs review pipeline in `preview` mode, stores result in `lease_reviews` with `status: 'preview', preview_only: true`. Returns preview data + a `paywall_token` valid for 30 minutes.

**Acceptance:** integration test: request upload URL → upload PDF directly to Storage → call process → receive structured preview with 1-2 redacted findings + total count; second upload from same email within 24h is rate-limited at the upload-url step (no wasted Storage cost); processing without a successfully uploaded PDF returns 400.

**4.5 — Backend endpoint: `POST /v1/lease-review/unlock`**
Receives `{stripe_payment_intent_id, paywall_token}` from post-payment success page. Validates payment intent is paid AND token matches existing preview review. Re-runs pipeline in `full` mode (or returns cached full result if already generated). Updates `lease_reviews` row with `status: 'unlocked', preview_only: false, stripe_payment_intent_id`.
**Acceptance:** integration test: pay test intent → unlock flips preview_only to false → returns full report; replay-attack with same intent ID returns existing review (idempotent); unpaid intent returns 402.

**4.6 — Frontend: lease review purchase flow (upload → preview → paywall)**
`/lease-review` page describes the product, has a single CTA: "Upload your lease to see what we'll find." Drag-drop or file picker for PDF. Email required (gates the preview, captures even non-converters).

Frontend flow matching 4.4's three-step backend:
1. Frontend calls `POST /v1/lease-review/upload-url` with email → receives signed upload URL + lease_review_id.
2. Frontend uploads PDF directly to the signed Supabase Storage URL (HTTP PUT). Show progress bar.
3. Frontend calls `POST /v1/lease-review/process` with lease_review_id → receives preview data + paywall_token.

After processing, render preview page with: one redacted high-severity finding ("⚠️ We found a potential FARE Act violation — see the full report to view the clause and which law it cites"), count of additional findings, and a "Get the full report — $29" CTA → Stripe Checkout. After payment, success page calls `/v1/lease-review/unlock` and renders the full structured review with sections per clause, severity badges, NY law citations, and prominent disclaimer.

**Mandatory legal-content blocks** (from `docs/legal/disclaimers.md`):

- **Pre-output framing on the report page** — render disclaimer §2.3 verbatim ("The report below explains what your lease appears to say…") *above* the structured findings. This is the single most important UPL-mitigation surface in the product per the attorney note in §2.3 of the disclaimer doc; do not abbreviate, paraphrase, or hide it behind a tooltip.
- **Pre-output framing on the preview page** — render disclaimer §2.3 verbatim above the preview as well (the preview is also AI-generated output).
- **Pre-output framing in the paywall modal** — render disclaimer §2.2 ("What this is / What this is not") inside the paywall modal so the user agrees to it before paying.
- **Footer "We Are Not" block** — render disclaimer §5 verbatim at the bottom of the preview, paywall, and full report pages.

These blocks are loaded from the same parsed-disclaimers JSON used by Phase 3.9.

**Acceptance:** end-to-end manual test in Stripe test mode: upload → preview → pay → full report. Refunds via Stripe Customer Portal fire the right webhook; refunded reviews show banner explaining access was revoked; user who never pays still has email captured. PDF flows directly to Storage, never through the Render backend (verify via Network tab — the PDF upload request goes to a Supabase URL, not to the Render service). Pre-output framing strings are byte-identical to disclaimer §2.3 (snapshot test); paywall modal includes §2.2; footer matches §5; v1-variant disclaimer is used until 4.1b ships.

**4.6b — Refund eligibility logic (ToS §4.3)**
Backend endpoint `POST /v1/refunds/request` enforces the eligibility rules from ToS §4.3:

- **One-time lease reviews:** automatic refund within 7 days if (a) the report did not generate (status never reached `unlocked`), or (b) the user has not loaded the unlocked report URL (track `first_viewed_at` on `lease_reviews`). Beyond that, return `{eligible: false, reason: 'manual_review_required'}` and route to support — do not auto-refund a viewed report.
- **Search Pass:** automatic refund of the most recent monthly charge if the request comes within 7 days of that charge AND the user has used fewer than 5 building searches AND zero lease reviews in the current billing period. Query `building_lookups` and `lease_reviews` with `user_id = $1 AND created_at > <last_charge_at>` to count.
- **No refund on used credits:** if a Search Pass user already consumed their monthly lease review credit, that credit's $29 equivalent is not refundable.

Endpoint returns `{eligible: bool, reason: string, refund_amount_cents: number}`. Approved refunds are processed via Stripe API, write a row to a new `refunds` table (id, user_id, lease_review_id nullable, subscription_id nullable, stripe_refund_id, amount_cents, eligibility_reason, created_at), and revoke access on the relevant `lease_reviews` row (set `preview_only = true`, clear `paywall_token`).

Frontend: a "Request a refund" button in the dashboard for any eligible item, plus a contact-support link for non-eligible cases.

**Acceptance:** integration test exercises each ToS §4.3 case (unviewed report → auto-refund; viewed report → manual review; Search Pass with 0 usage in 7 days → auto-refund; Search Pass with 6 lookups → not eligible; used lease credit → not eligible); refund row written; revoked review's full report URL returns 402.

**4.7 — Email follow-up after lease review**
Use Supabase pg_cron (free, included) to schedule two recurring jobs:

1. Hourly job: find `lease_reviews` rows where `status = 'unlocked' AND unlock_email_sent_at IS NULL AND created_at < NOW() - INTERVAL '24 hours'`. For each, call a Supabase Edge Function that sends the unlock follow-up via Resend ("Your review is saved at <link>. Here are 3 NYC tenant-rights organizations [Met Council, Right to Counsel NYC, JustFix]. Did this report help? <yes/no link>"). Set `unlock_email_sent_at = NOW()`.

2. Hourly job: find `lease_reviews` rows where `status = 'preview' AND abandonment_email_sent_at IS NULL AND created_at < NOW() - INTERVAL '4 hours' AND created_at > NOW() - INTERVAL '5 hours'` (narrow window to avoid sending repeatedly). Send "Your preview expires soon — unlock the full review for $29." Set `abandonment_email_sent_at = NOW()`.

Why pg_cron + Edge Function instead of a Node cron: Supabase pg_cron is free; Render's cron service is a paid product. Edge Functions on Supabase free tier handle this scale comfortably.

**Acceptance:** unlock email sends 24-25h after full unlock; preview-abandonment email sends 4-5h after preview generation if not unlocked; click on yes/no link logs response in `lease_reviews.feedback` column; pg_cron jobs visible in Supabase dashboard.

---

## Phase 5 — Search Pass subscription (depends on Phase 1, 2, 3, 4)

**5.1 — Stripe subscription wiring**
Backend endpoint `POST /v1/subscriptions/checkout-session` creates a Stripe Checkout session. Webhook handler at `POST /v1/webhooks/stripe` processes `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and updates the `subscriptions` table via service role.
**Acceptance:** integration test in Stripe test mode: create checkout session → complete → subscription row written; cancel via Customer Portal → row updated to canceled; trigger past-due → row updated.

**5.2 — Subscription gates on backend**
Hono middleware `requireSubscription` that wraps endpoints requiring Search Pass. Returns 402 with structured `{error: "subscription_required", checkout_url: string}` for non-subscribers.
**Acceptance:** unit tests: free user on saved-searches endpoint returns 402; paid user returns 200; canceled-but-still-in-period user returns 200; canceled-and-period-ended returns 402.

**5.3 — Saved buildings + violation alerts**
Schema: `saved_buildings` (id, user_id, building_bbl, last_violations_snapshot jsonb, created_at). RLS: users can only read/insert/delete their own saved buildings. Backend endpoint `POST /v1/saved-buildings` (Search Pass only).

Daily cron via Supabase pg_cron: for each saved_building, fetch fresh violations from NYC Open Data (cached if recent), diff against `last_violations_snapshot`, and if any new violations appeared, queue an email via Resend. Update `last_violations_snapshot` after notification.

**Acceptance:** add a saved building → seed a fake new violation → cron run → user receives email within 24h with the new violation summary.

**5.4 — Frontend: dashboard for paid users**
`/dashboard` page (auth + subscription required) shows: list of building lookups (queried via Supabase client with RLS), list of saved buildings with alert status, monthly lease review credit balance, link to Customer Portal. Free users see an upgrade page on this URL.
**Acceptance:** subscribed user sees full dashboard; free user sees upgrade page with one-click checkout.

**5.5 — Search Pass paywall conversion logic**
After a free user (identified by email) does 3 building lookups in a 30-day window, the next lookup attempt triggers a paywall modal: "You've used your 3 free monthly lookups. Get unlimited for $14.99/mo, cancel anytime."

Counter source of truth: pre-auth users tracked in `email_lookup_counters` (Phase 1.3); post-auth users tracked via aggregate query against `building_lookups` for the 30-day window. When a user authenticates for the first time, a backend job migrates their `email_lookup_counters` row's count into the corresponding `building_lookups` history (no separate counter on `profiles` is needed since we can compute it from `building_lookups`).

PostHog feature flag controls threshold (3 vs 5 vs 1) for A/B testing. **No IP-based tracking** — IPs unreliable for NYC users on VPN/mobile data.

**Acceptance:** lookup count tracked accurately whether user has email-only or full auth; paywall renders correctly at threshold; PostHog feature flag toggles threshold without code change; user with same email across two browsers shares the counter.

---

## Phase 6 — FARE Act compliance tool as standalone SEO magnet (depends on Phase 3.6)

**6.1 — Standalone FARE Act page**
`/fare-act` page that explains the law, has a free check-your-listing form (paste URL → instant compliance verdict using 3.6), and a CTA to "Recover your illegal broker fee — generate a complaint letter." Complaint letter generator is free.

**Mandatory legal-content blocks** (from `docs/legal/disclaimers.md`):

- **Pre-output framing on the check result** — render disclaimer §3.3 verbatim ("The check below compares the listing or lease term to the FARE Act. Whether DCWP would treat any particular fact pattern as a violation is up to DCWP…") *above* the result. The `flag` field from 3.6 (renamed from `compliant`) renders below this framing.
- **"What this is" panel on the page** — render disclaimer §3.2 in a collapsible panel above the form.
- **Footer "We Are Not" block** — render disclaimer §5 verbatim at the bottom.

**Acceptance:** page ranks within top 50 Google results for "FARE Act NYC" within 30 days of launch; the embedded compliance check works; framing strings byte-identical to disclaimer §3.2 and §3.3 (snapshot tests).

**6.2 — DCWP complaint letter generator**
PDF generation using `pdfkit` server-side (Node-native, lightweight). Takes user info (name, listing URL, broker fee amount, date paid) and produces a complete DCWP complaint draft.

**Disclaimer language on the generated PDF and on the generator UI**, matching disclaimer §3.2 verbatim:

> The draft is for your review only. You decide whether to submit it. You are responsible for the accuracy of any letter you submit to DCWP. We are not your representative and we do not file on your behalf.

This appears as a banner on the generator UI (before the user clicks generate) and as the first non-letterhead block of the PDF itself. The generated PDF also footers with disclaimer §5 ("We are not…").

**Acceptance:** generated PDF renders correctly; includes all required DCWP form fields; disclaimer is prominent on UI and on PDF; snapshot test confirms language is byte-identical to disclaimer §3.2 paragraph 3.

**6.3 — Press push: launch the FARE Act tool**
Cold-email pitch deck for: Brick Underground, Curbed NY, The City, NY1, 6sqft, NY Mag's Curbed, NY Times Real Estate. Pitch angle: "Free tool helps NYC renters detect FARE Act violations and recover illegal broker fees." Include data on common violation patterns from the first 100 tool uses.
**Acceptance:** at least 2 press hits within 6 weeks of launch.

---

## Phase 7 — B2B foundations (implementation months 7+; warm-up runs in parallel from month 4)

**The implementation work below (7.1, 7.2, 7.4) is gated on month 7+ — it should not steal founder time from Phase 3-6 consumer work. But the warm-up work (7.3 expanded; CRM building, attorney conversations, demo capability) should be in motion by month 4-5.** A fast B2B pivot in response to a missed day-90 consumer checkpoint (see Success Metric and Kill Criteria) needs warm pipeline, and warm pipeline takes lead time. Treat 7.3 as a **parallel track starting month 4**, not as a sequential Phase 7 step. The cost is a few hours per week; the return is a B2B pipeline that's months ahead of where it would be if Phase 7 started cold at month 7.

**7.1 — Backend: organization model**
Schema: `organizations` (id, name, type enum [law_firm, relocation_company, broker], stripe_customer_id, logo_storage_path nullable, created_at). `organization_members` (org_id, user_id, role enum [admin, member]). `organization_subscriptions` (id, org_id, stripe_subscription_id, plan enum [solo_attorney, firm, relocation], seats, status, current_period_end). RLS: members can read their org; admins can update.
**Acceptance:** migration applies; can create an org, add members, attach a subscription, upload a logo to `firm-logos` Supabase Storage bucket.

**7.2 — White-label lease review for law firms**
Plan "Solo Attorney" ($199/mo): unlimited lease reviews for clients, branded report PDFs (firm logo + name from Supabase Storage), client-management dashboard. Plan "Firm" ($499/mo): same + multi-attorney seats + audit log + bulk client onboarding via CSV.
**Acceptance:** attorney signs up → uploads firm logo to Supabase Storage → runs lease review for client → exports branded PDF (server-side rendered with `@react-pdf/renderer` for layout flexibility); bulk endpoint accepts CSV of client emails and sends invites.

**7.3 — Outbound sales tooling and warm-pipeline build (START MONTH 4, NOT MONTH 7)**
This phase has two halves. The **warm-up half runs in parallel with Phases 3-6** and exists specifically to make a B2B pivot fast if the day-90 consumer checkpoint misses. The **outbound execution half** runs from month 7 once Phase 7.1-7.2 implementation lands.

**Warm-up (months 4-6, parallel with consumer build):**
- Build a CRM (Notion or Airtable) with 50+ NYC tenant attorneys, 10 relocation companies, 5 brokerages with rental volume. Source from NYSBA tenant law section directory, NYCLA, public court filings, and LinkedIn.
- Run 5-10 informational "research calls" with NYC tenant attorneys (offer to pay $100/call as research interviews). Goal: validate the $199/mo solo plan, understand their lease-review workflow, identify must-have features.
- Record a 3-5 minute demo Loom of the consumer lease review flow (re-skinned with placeholder firm branding) to show on calls. This is your B2B "demo" without the full Phase 7.2 implementation.
- Make the founder visible in the professional adjacency: 1-2 LinkedIn posts/month about NYC tenant law tech, NYSBA tenant-law section involvement if accessible, comments on relevant Brick Underground/Curbed pieces.

**Outbound execution (month 7+):**
- Cold-email sequence (3-5 touch) to the warm CRM. Templates referenced from research-call insights.
- Calendly link for booked calls.
- PostHog tracks every B2B page visit and traces back to source CRM record where possible.

**Acceptance (warm-up, by end of month 6):** CRM contains 50+ attorney prospects with notes; ≥5 informational interviews completed and logged; demo Loom recorded and shared on a private link; founder has posted ≥4 NYC-tenant-law-related items on LinkedIn.
**Acceptance (outbound, by end of month 8):** outbound sequence is automated; first 5 calls booked; first signed customer at $99-199/mo by end of month 9.

**7.4 — Relocation company custom contracts**
Custom integration spec for one Bristol Global Mobility, Cornerstone, or Plus Relocation contract: API access for batch building lookups, monthly reporting, SLA. Pricing: $499-999/mo per company.
**Acceptance:** API key issued; first 100 batch lookups completed via API; monthly report PDF generated and emailed.

---

## Phase 8 — Hardening (interleaved with Phases 3-7)

**8.1 — Rate limiting + zod validation everywhere**
In-process Hono rate limiter on every endpoint (Render free tier is single-instance, so in-memory is fine for v1). Per-endpoint zod schemas. Errors: `{error: {code, message, requestId}}`. Document the rate-limit policy in `backend/RUNBOOK.md`.
**Acceptance:** integration tests for malformed payloads return 400 with stable shape; rate-limited requests return 429 with retry-after.

**8.2 — Integration test suite**
`node:test` + `undici`. GitHub Actions runs against ephemeral local Postgres via Docker. Coverage report for auth flows, lookups, lease reviews, subscription webhooks. **Note:** because auth is Supabase-managed, the auth tests are minimal — verify the Next.js middleware properly rejects unauthenticated requests, that's it.
**Acceptance:** CI green on every PR; coverage ≥80% for the listed handlers.

**8.3 — Frontend error boundaries + retry logic**
React error boundaries on key pages. API client with exponential backoff (1s → 2s → 4s capped at 30s) on 5xx, no retry on 4xx. **Account for Render free-tier cold starts** (~30s) — first request after idle should show a longer-than-usual loading state, not error out.
**Acceptance:** simulated 503 from backend triggers up to 3 retries; user sees clear error UI after final failure; cold-start request shows "Warming up..." state for 30s before erroring; error logged to Sentry once 8.4 ships.

**8.4 — Sentry + structured logging (ADD AT MONTH 3, NOT FROM LAUNCH)**
Sentry on frontend (production builds only) and backend. Pino logs include correlation IDs that match Sentry trace IDs. Pre-launch errors are not actionable; defer this until you have real users.
**Acceptance:** a forced error in production lands in Sentry within 1 minute; the same error's pino log entry contains the matching Sentry trace ID.

**8.5 — Monitoring + alerting**
UptimeRobot uptime monitor on `/health`. Discord webhook for alerts. Manual checks (no paid alerting tier in v1):
- p95 latency check via PostHog dashboard, reviewed weekly
- error-rate check via Sentry dashboard (once 8.4 ships), reviewed weekly
- Stripe webhook failure alert via Stripe dashboard email (free)
- OpenAI cost-spike: a daily Supabase pg_cron job runs SQL against `ai_usage` and, if previous-day spend >$50, calls a Supabase Edge Function that posts to a Discord webhook

**Acceptance:** UptimeRobot triggers Discord alert within 5 minutes of `/health` going down; cost-spike pg_cron runs successfully and posts to Discord when synthetic over-cost data is inserted.

**8.6 — Account deletion, per-lease deletion, data export, and retention reconciliation**
**Per-lease deletion** (Privacy Policy §6.2: "You can delete a lease PDF immediately at any time from your account dashboard"): backend endpoint `DELETE /v1/lease-reviews/:id` and a delete button in the dashboard. Deletes the PDF from Supabase Storage immediately; preserves the structured `lease_reviews` row but nulls `pdf_storage_path`, `extracted_text`, and `ai_report.excerpts` (the latter to remove the lease's verbatim text); sets `pdf_deleted_at = NOW()`. Anonymous users delete via the post-payment paywall_token + a one-time delete link emailed with the receipt.

**Per-lookup deletion**: backend endpoint `DELETE /v1/building-lookups/:id` for parity (the Privacy Policy promises broad deletion rights in §9.1).

**Account deletion**: Supabase Auth has built-in account deletion via `auth.admin.deleteUser()`. Backend endpoint `/v1/account/delete` does NOT immediately purge — it follows Privacy Policy §6.1 ("while your account is active, plus 90 days after closure"):

- Marks `profiles.deletion_requested_at = NOW()` (new column).
- Cancels the active Stripe subscription with `cancel_at_period_end = false` (immediate cancellation; user has indicated they want out).
- Sends confirmation email with a 30-day undo link.
- A Supabase pg_cron job runs daily, finds rows where `deletion_requested_at < NOW() - INTERVAL '90 days'`, and at that point: calls `auth.admin.deleteUser()`, deletes all `building_lookups`, `lease_reviews`, `saved_buildings`, Storage objects, and the `profiles` row itself. **Exception**: payment records on `subscriptions` and `refunds` are retained for 7 years per Privacy Policy §6.1 with `user_id` nulled; `email_lookup_counters` is purged immediately.

**Data export** (Privacy Policy §9.1): `/v1/account/export` endpoint emails user a JSON tarball with all their data within 24h.

**Acceptance:** deleting a lease via the dashboard removes the Storage object within 5 seconds and the row's lease text/excerpts are nulled; deleting a building lookup row removes it; account deletion flips a flag, sends an email, and a synthetic 91-day-old deletion request is purged on the next pg_cron run; subsequent login attempt fails (Supabase Auth refuses); data export job emails the tarball within 24h; payment records survive account deletion with `user_id = NULL`.

**8.7 — Privacy policy + terms of service**
Live `/legal/privacy` and `/legal/terms` pages with attorney-approved language from 0.1. Cookie banner ONLY if you add cookies beyond Supabase Auth (which uses HTTP-only session cookies that don't require a banner under most jurisdictions). Cloudflare Web Analytics is cookieless.

**Retention rules (must match Privacy Policy §6.1 exactly).** Implemented via Supabase pg_cron jobs that nightly purge anything past its retention window:

| Data | Retention | Implementation |
|---|---|---|
| Account info | While active + 90 days after closure | Phase 8.6 deletion grace |
| Lease PDFs and extracted text | 90 days from upload, then auto-purged regardless of save status | Daily pg_cron deletes Storage object + nulls `extracted_text`, `ai_report.excerpts`, `pdf_storage_path` on `lease_reviews` rows where `created_at < NOW() - INTERVAL '90 days'` |
| Saved lease reports (structured summary, no excerpts) | While account active | No cron; lives until user deletes |
| Building search history | 12 months | Daily pg_cron deletes `building_lookups` rows older than 12 months |
| Saved buildings | While account active | No cron |
| Payment records (`subscriptions`, `refunds`) | 7 years | Retained with `user_id` nulled on account deletion |
| Logs (usage, security) | 12 months | Daily pg_cron purges `ai_usage` and pino log archives |
| Backups | Up to 35 days from creation | Supabase managed |

**Privacy audit script** (`scripts/privacy-audit.sh`) checks: no PII in logs, no PII in URLs, no third-party tracking pixels, and that the retention pg_cron jobs are scheduled on the production project.

**Acceptance:** privacy and terms pages live; retention pg_crons all scheduled and visible in Supabase dashboard; synthetic 91-day-old lease PDF is auto-purged on next cron run; synthetic 13-month-old building lookup is purged; payment records survive a synthetic account deletion with nulled user_id; privacy audit script passes.

[Note: Privacy Policy §2.1 currently lists "password (stored hashed)" as collected information. Magic-link auth means we do not collect passwords. Privacy Policy §8 currently names Plausible/PostHog as analytics; production uses Cloudflare Web Analytics + PostHog. These are legal-doc edits, not roadmap changes — see "Legal-doc edits required" section at end of this document.]

**8.8 — Forced upgrade / API versioning enforcement**
Every backend endpoint already prefixed `/v1/` from Phase 3 onward. `X-Client-Version` header from frontend. Future breaking changes go to `/v2`. Add deprecation banner system on frontend that activates if backend returns `X-Deprecation` header.
**Acceptance:** all endpoints reachable at `/v1/...`; frontend sends version header; integration test confirms 410 Gone is returned if a deprecated endpoint is hit.

**8.9 — Watchlist import cron job**
Convert manual `npm run import-watchlist` from 3.5 into a monthly Supabase pg_cron job that calls a Supabase Edge Function. The Edge Function pulls the latest Public Advocate Worst Landlord Watchlist (CSV/JSON download from the public site), updates `landlords.watchlist_rank`, and posts to Discord on failure or if any landlord changes rank by ≥10 positions.

**Acceptance:** pg_cron runs monthly; failure triggers Discord alert; rank-change alert fires when synthetic data is rotated.

**8.10 — Affiliate disclosure UI + "How we make money" page**
Implements the disclosure-at-click-through commitment in disclaimer §4.1 and the dedicated "How we make money" page in §4.2.

- **Click-through interstitial component.** Reusable React component `<AffiliateLinkButton partner="lemonade" href="...">`. On click, opens a modal with the disclaimer §4.1 short-form text ("RentGuard NYC earns a commission if you purchase through this link…") and a "Continue to [partner]" CTA. Logs to `affiliate_clicks` whether or not the user proceeds. The component replaces every raw affiliate `<a>` tag in the codebase.
- **"How we make money" page** at `/how-we-make-money`. Renders disclaimer §4.2 verbatim plus a plain-English summary of: which partners we use, what we earn per conversion, what we do *not* take money from (landlords, brokers, law firms outside the B2B program), and how the report content is generated independently of any commercial relationship. Linked from the footer of every page and from the click-through modal.
- **Per-report footer note**: every report page (building lookup, lease review, FARE Act check) includes a small "How we make money" link in the footer alongside the §5 "We Are Not" block.
- **Cross-disclosure in ToS §5**: ToS §5 already includes the affiliate disclosure; verify the rendered page matches the document.

**Acceptance:** every affiliate link in the codebase routes through `<AffiliateLinkButton>` (lint rule or grep audit catches raw `lemonade.com`/`bellhop.com`/`moved.com` `href`s outside the component); clicking an affiliate link opens the modal and logs to `affiliate_clicks` with `clicked_modal_at` set; clicking "Continue" sets `clicked_through_at`; "How we make money" page is reachable, lists all three partners, and matches disclaimer §4.2 word-for-word (snapshot test); footer link present on all report pages.

---

## Phase 9 — Distribution surfaces (deferred from year 1 unless metrics justify)

**9.1 — Bookmarklet (low-effort, 1 session)**
JavaScript snippet user drags to bookmarks bar. Click on any StreetEasy/Zillow listing → opens `rentguard.nyc/lookup?url=<currentUrl>` in a new tab. No install, no maintenance.
**Acceptance:** bookmarklet works on StreetEasy, Zillow, Apartments.com.

**9.2 — Mobile web optimization**
Most NYC apartment hunting happens on phones. Audit mobile experience: paste URL flow on iOS Safari, results page legibility, share-to-iMessage of OG previews, payment flow on mobile Stripe Checkout.
**Acceptance:** Lighthouse mobile score ≥85 on `/`, `/lookup`, `/lease-review`; manual tests on iPhone Safari and Chrome Android.

**9.3 — Chrome extension (DEFERRED to year 2)**
Skipped in year 1 because: (a) install ceiling is ~3,000 users for niche real-estate extensions, (b) maintenance burden across StreetEasy/Zillow DOM changes is real, (c) doesn't change fundamental distribution. Revisit only if year-1 MRR ≥ $5K and there's signal that power users want inline overlay.

**9.4 — Native iOS app (DEFERRED to year 2)**
Only build if year-1 MRR ≥ $8K and ≥40% of traffic is mobile web users repeatedly returning. iOS Share Sheet integration is the killer feature, not a separate UX.

---

## Phase 10 — Launch and scaling

**10.0 — Creator asset pipeline (RUNS BEFORE 10.1)**
Before the creator shoots their first batch, produce the assets they need: 20 reusable b-roll clips (you record screen demos of the product analyzing real listings — anonymized), 30 script templates (15-30s hook + demo + takeaway, in your voice), branded lower-thirds template (logo + handle), 10 example listings for the creator to react to (curated weekly). Save all assets to a shared Google Drive or Frame.io workspace.
**Acceptance:** creator has access to ≥20 b-roll clips, 30 scripts, lower-thirds template, and a fresh "this week's listings" folder; first shoot can use materials end-to-end without you on the call.

**10.1 — Soft launch with creator videos**
First 10 creator videos go live. Public landing page goes live. Beehiiv waitlist gets launch announcement. Reddit r/AskNYC and r/NYCapartments organic posts (not spammy — answer real questions, mention tool only when relevant). **Day 0 of the kill-criteria checkpoints (see Success Metric and Kill Criteria) starts on this day.**
**Acceptance:** 1,000 unique visitors in week 1; ≥5 paid lease reviews; ≥1 video over 50K views.

**10.2 — Press push**
Cold-email FARE Act tool to NYC press contacts. Brick Underground, Curbed NY, NY1, The City. Pitch deck includes anonymized data from first 100 building lookups.
**Acceptance:** ≥1 mid-tier press hit within 30 days; ≥1 top-tier hit within 90 days.

**10.3 — Tenant rights org partnerships**
Email Met Council on Housing, Right to Counsel NYC, Brooklyn Tenant Coalition. Offer free lifetime Search Pass to their members in exchange for newsletter mentions. No paid sponsorship.
**Acceptance:** ≥2 partnerships signed within 60 days; partnerships drive ≥500 signups within 90 days.

**10.4 — SEO content engine**
Use Claude Code as drafting partner. Publish 10 long-form posts/week across: `/neighborhood/[slug]` (every NYC neighborhood + crime/violation/eviction stats), `/landlord/[slug]` (every Worst Landlord watchlist entry with portfolio details), `/topic/...` (FARE Act explainers, security deposit law, rent stabilization 101). All posts have schema.org structured data. Use Next.js ISR with 24-hour revalidation so the CDN handles traffic spikes for free.
**Acceptance:** 80-120 posts published by month 6; at least 30 ranking on Google page 1 for their target query by month 9.

**10.5 — Annual subscription tier**
Add Search Pass annual at $99/year (~44% off). Capture power users and movers. Stabilizes MRR.
**Acceptance:** annual checkout flow works; existing monthly subscribers see in-app upsell to switch.

---

## Suggested execution order

```
0.1 (legal, async) → 0.2 (Supabase + Vercel + Render + Cloudflare + vendor DPAs) → 0.3 (data sources) → 0.4 (Stripe) → 0.5 (creator search) → 0.6 (domain + Beehiiv)
↓
1.1 → 1.2 → 1.3 → 1.4 → 1.5 → 1.6 → 1.7   (foundation; ~7 sessions)
↓
2.1                                       (Supabase Auth config; 1 session)
↓
3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.7b → 3.8 → 3.9 → 3.10  (free building lookup; ~11 sessions; 3.9 includes pre-output framing + footer)
↓
[Soft launch the free building lookup; collect email signups; iterate based on TikTok response]
↓
[MONTH 4 — START PHASE 7.3 WARM-UP IN PARALLEL: build CRM, run 5-10 attorney research calls, record demo Loom. ~2-4 hrs/week.]
↓
4.1a → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → 4.6b → 4.7  (lease review v1 with 5 clauses; ~8 sessions; 4.6 includes pre-output framing, 4.6b is refund eligibility logic)
↓
4.1b                                      (clause library expansion + swap to full §2.2 disclaimer; ~1 session)
↓
6.1 → 6.2 → 6.3                           (FARE Act SEO magnet; ~3 sessions; 6.1 includes pre-output framing)
↓
5.1 → 5.2 → 5.3 → 5.4 → 5.5               (Search Pass subscription; ~5 sessions)
↓
8.1 → 8.2 → 8.3 → 8.4 → 8.5 → 8.6 → 8.7 → 8.8 → 8.9 → 8.10   (hardening; ~10 sessions; 8.6 includes per-lease delete + 90-day grace, 8.7 includes retention crons, 8.10 is affiliate disclosure UI)
↓
9.1 → 9.2                                 (bookmarklet + mobile web; ~2 sessions)
↓
10.0 → 10.1 → 10.2 → 10.3 → 10.4 → 10.5   (launch + scaling; ongoing)
↓
[DAY 30 / 60 / 90 / 180 KILL CHECKPOINTS — see Success Metric and Kill Criteria]
↓
[At month 7+ if MRR ≥ $4K AND day-90 checkpoint passed]
↓
7.1 → 7.2 → 7.3 (outbound execution) → 7.4   (B2B implementation; ~4 sessions, leveraging warm pipeline from month-4 7.3 warm-up)
↓
[OR at day 90 if checkpoint missed]
↓
[See Pivot scenarios: B2B-only, FARE Act-only, or wind-down]
```

**Why 2.1 ships before Phase 3:** the lookup endpoint in 3.8 references authenticated users (60/hr rate limit, dashboard access). If 2.1 lands later, that path is dead code and the integration tests for 3.8 can't validate the auth branch. Better to ship Supabase Auth config (one quick session) before the bulk of Phase 3.

**Why 8.10 (affiliate disclosure UI) is in the hardening phase, not earlier:** the disclosure-at-click-through commitment in disclaimer §4.1 is binding from the moment the first affiliate link goes live. If you ship a Lemonade link in Phase 3.9 or 5.4 before 8.10 lands, you're out of compliance. The execution order above puts the first affiliate-link-bearing pages (3.9 lookup result page, 5.4 dashboard) ahead of 8.10, which means **either** affiliate links must be feature-flagged off until 8.10 ships, **or** 8.10 should move up to land before 3.9. Recommendation: feature-flag affiliate links off until 8.10 lands; revenue impact is negligible until traffic scales.

**Why 7.3 warm-up runs from month 4, not month 7:** see Phase 7 intro. A B2B pivot at the day-90 kill checkpoint is only fast if there's a warm pipeline. Cold outreach from a standing start at month 7 takes 4-6 weeks to produce a single call; by then founder energy and runway have decayed and the pivot may not happen. The warm-up cost is a few hours per week starting month 4 — cheap insurance.

**Honest estimate:** ~58-68 focused Claude Code sessions to a real revenue-generating product. Phase 3 (data integration), Phase 4 (lease review legal posture), and Phase 7.3 warm-up (relationship-building, less directly measurable) remain the biggest unknowns. Plan for ~20 hrs/week of founder time over 8-12 months.

---

## Cost summary (year 1, at small scale)

| Item | Monthly cost | Notes |
|---|---|---|
| Supabase free tier (months 0-6) | $0 | 500MB DB, 1GB storage, 50K MAU, pg_cron + Edge Functions included |
| Supabase Pro (months 6-12, when needed) | $25 | 8GB DB, 100GB storage, 100K MAU |
| Vercel Hobby | $0 | Frontend hosting; commercial gray-area, switch to Cloudflare Pages if concerned |
| Render free tier | $0 | Spin-down backend; cold starts ~30s; sufficient because crons run on Supabase pg_cron |
| Render Starter (only if cold-start UX is unacceptable) | $7 | Always-on backend |
| Cloudflare Web Analytics | $0 | Free pageview analytics |
| PostHog free tier | $0 | 1M events/mo |
| Sentry free tier (from month 3) | $0 | 5K errors/mo |
| UptimeRobot free | $0 | 50 monitors |
| Resend free tier | $0 | 3K emails/mo |
| Beehiiv free tier | $0 | Up to 2.5K newsletter subs |
| Domain | ~$2.50 | $30/year amortized |
| OpenAI / Anthropic API (variable) | $10-100 | Scales with usage; gross margins ~95%+ on AI calls |
| Stripe fees (variable) | 2.9% + $0.30/txn | Pass-through cost |
| Legal consultation (one-time) | $500-800 | Phase 0.1 |
| Attorney research calls (Phase 7.3 warm-up) | $500-1,000 one-time | 5-10 calls at $100/each, months 4-6 |
| TikTok creator | $1,500-2,500 | Once Phase 0.5 closes |
| **Fixed monthly burn (months 0-6)** | **~$2.50** | Domain only |
| **Fixed monthly burn (months 6-12)** | **~$30** | + Supabase Pro |
| **Variable monthly cost at $5K MRR** | **~$300** | AI + Stripe fees + creator |

**Supabase free-tier budget watchpoints:**
- Postgres 500MB cap: `lease_reviews.extracted_text` is the biggest row (typed leases ~10-30KB, scanned ~30-100KB). At 100 reviews/month + 1000 building lookups/month with `ai_summary` ~2KB each, you'll consume ~5MB/month. Budget allows 6+ months before crossing 500MB, but watch the row counts.
- Storage 1GB cap: lease PDFs ~1-5MB each. At 100 paid reviews/month + 100 abandoned previews/month, that's ~200MB per active month. Per Privacy Policy §6.1 and Phase 8.7, ALL lease PDFs (paid or preview-only) are auto-purged 90 days from upload regardless of save status. At 200MB/month accumulating with a 90-day window, steady-state storage is ~600MB — fits the 1GB free tier with margin. The structured `ai_report` summary survives in Postgres while the account is active; only the PDF and `extracted_text` are deleted.
- Edge Function invocations 500K/month: pg_cron jobs, transactional email sends, and webhook handlers all count. Budget allows ~16K/day; at expected scale you'll be at ~1-2K/day.

This is the version of the stack to ship.

---

## Things deliberately NOT included in year 1

- **Native iOS app.** Most NYC apartment hunting happens on mobile web. Native app is a year-2 decision conditional on metrics.
- **Chrome extension.** Install ceiling for niche real-estate extensions is ~3,000 users. Bookmarklet does 80% of the job at 1% of the build cost.
- **Multi-city expansion.** NYC alone has ~120,000 lease signings/year. Year-1 captures non-NYC interest in `non_nyc_waitlist` for free.
- **Deep landlord LLC unmasking via NYCDB / ACRIS join.** V1 surfaces the HPD-registered owner only. Full portfolio tracing across LLCs requires either running JustFix's NYCDB stack ourselves or building the join from scratch against ACRIS deeds. Revisit at year-2.
- **Real review collection (à la OpenIgloo).** Crowdsourced reviews require moderation infrastructure and 5+ years of data to be valuable.
- **Roommate matching, listings marketplace, broker referrals as core product.** Stay neutral; monetize via affiliate, not transaction.
- **Tenant lawsuit-filing automation.** UPL boundary is too dangerous to cross.
- **AI chatbot for tenant questions.** NY SB 7263 specifically targets this.
- **Custom auth implementation.** Supabase Auth covers the use case; rolling our own would add 4 chunks of work for zero user-facing benefit.
- **Self-hosted analytics / monitoring.** PostHog Cloud + Cloudflare Analytics + Sentry free tiers are sufficient at this scale; self-hosting would add infrastructure overhead with no benefit until 10x current scale.

---

## Pivot scenarios

If the day-90 or day-180 kill-criteria checkpoint misses, two pivots are viable. **Pick one within 30 days of the missing checkpoint; running both is not viable for a solo founder.** This section exists to make the pivot decision a pre-committed playbook rather than a fresh strategy session at the worst possible time.

### Pivot A — B2B-only

**Premise.** The technology and content work; consumer acquisition doesn't pay back. NYC tenant attorneys and relocation companies have budget and steady demand for the same lease analysis the consumer side builds. The Phase 7.3 warm-up should have produced a CRM of 50+ attorney prospects by this point.

**First 30 days after pivot decision:**
- **Stop creator spend immediately.** Pause the TikTok creator contract; keep landing pages live as SEO surface for B2B inbound.
- **Stand up Phase 7.1-7.2 white-label implementation** if not already done. ~4-6 sessions of work.
- **Move the consumer-side site to a "for renters" subdomain or section,** repositioned as free SEO content that drives attorney/firm inbound. The NYC neighborhood and landlord pages from Phase 10.4 keep working in this mode and become a lead source for B2B.
- **Run 50 cold-email outreach from the warm CRM** (template from 7.3); book 10 demos.
- **Ship one signed Solo Attorney customer at $99-199/mo within 60 days of pivot decision.**

**Economics.** 5 firms at $199/mo + 10 solo attorneys at $99/mo = ~$1,990/mo within 90 days of pivot. Reach 30 firm + 50 solo customers within 12 months → ~$10K/mo, meeting year-1 P90 target through B2B alone. Achievable if warm-up happened in parallel; difficult from a cold start.

### Pivot B — FARE Act-only single product

**Premise.** The building lookup converts but the lease review doesn't (or doesn't justify its legal-risk surface), OR legal exposure on the lease review tool spikes (SB 7263 enacts, FTC enforcement against a comparable product, demand letter from a building owner). FARE Act compliance + the complaint letter generator is a narrower, lower-risk product with a clearer value prop.

**First 30 days after pivot decision:**
- **Strip Phase 4 (lease review) entirely from the live site.** Leave the building lookup and FARE Act tool. Refund any active Search Pass subscribers pro-rata; lease review one-time customers within the 7-day window get auto-refunds.
- **Reframe the homepage around FARE Act recovery:** "Did your landlord charge an illegal broker fee? Find out in 30 seconds." Build dedicated landing pages per common violation pattern.
- **Add an attorney-referral revenue line:** $200-500 per qualified referral to NYC tenant attorneys handling FARE Act recovery cases. This is B2B revenue without a B2B implementation; the warm CRM from 7.3 makes this 1-2 weeks of work, not months.
- **Pursue press as in Phase 6.3;** the FARE Act tool is now the entire pitch.

**Economics.** Narrower TAM, but lower CAC and lower legal risk. Attorney referrals at $200-500/conversion + ongoing SEO play could sustain a one-person product at $2-4K MRR with much lower founder time investment than the full plan. Ceiling is lower than Pivot A, but floor is higher and time-to-revenue is faster.

### Pivot C — Wind-down (the third option)

If neither Pivot A nor Pivot B looks viable at day 90 or day 180 — usually because total traffic is too low to support either path, or because the founder's runway has compressed — **the right move is to wind down with dignity rather than grind to month 12.** Failed bootstrap attempts that wind down at month 4-6 leave the founder in much better shape than ones that grind to month 12 with no resources and no learnings to apply elsewhere.

**Steps:**
- Issue refunds proactively to all active Search Pass subscribers and any lease review customers within the 7-day window.
- Retain the SEO content as a passive asset (the `/building/[bbl]` ISR pages keep ranking on Google with $0 maintenance cost; these may be sold or licensed in year 2).
- Document the build-vs-buy reasoning, the unit economics that didn't work, and the legal-doc work as a portfolio artifact.
- Reinvest founder time elsewhere — into the next project, into B2B-only consulting using the NYC tenant law expertise built up, or into rest. Burnout-driven failures damage future entrepreneurship more than a clean wind-down does.

**The hard part.** Pivot C is the option founders most often skip past, especially solo bootstrappers, because admitting the consumer hypothesis didn't work feels like personal failure. It isn't. The hypothesis was reasonable; the market said no. Note this section pre-launch; revisit at day 90 and day 180; do not let sunk-cost fallacy keep you grinding past month 6 if the numbers say it's time.

---

## Red flags that should change the plan

- **NY SB 7263 passes during year 1.** Strip lease review of any advice-shaped output; reposition as "lease summary + clause dictionary." Lease tool revenue drops 40-60%; compensate by accelerating Search Pass features and B2B push. **Hard threshold:** if SB 7263 enacts, trigger Pivot B (FARE Act-only) within 30 days unless attorney from 0.1 confirms the lease tool can be re-scoped to compliance.
- **OpenIgloo (or StreetEasy/Zillow) ships listing analysis or AI summary feature.** Pivot positioning toward FARE Act compliance + lease review + B2B (their brokerage conflict-of-interest is your wedge). **Hard threshold:** if a major incumbent ships AI summaries within 6 months of RentGuard launch, the consumer wedge is closed; trigger Pivot A or B at next checkpoint.
- **Creator's videos consistently miss 50K views by month 3.** Replace creator within 30 days. **Hard threshold:** if second creator (replacement) also misses 50K views by their month 3, distribution itself is the problem — trigger pivot review at day 90 even if MRR floor is met, because the floor won't sustain.
- **Building lookup conversion to email below 20% at day 60.** AI summary isn't compelling enough. Iterate prompt + result page UX. **Hard threshold:** below 15% at day 90 → kill consumer top-of-funnel; trigger Pivot A or wind-down.
- **Lease review preview-to-paid conversion below 10% at day 60.** Either price wrong ($29 might be too high) or preview reveals too much / too little. Test $19 and 0 vs 1 vs 2 findings in preview. **Hard threshold:** below 7% at day 90 → strip lease review per Pivot B.
- **Stripe deplatforms over rental-content adjacency.** Document policy compliance carefully (we're not a marketplace; we're an information tool). Move to alternate processor (Paddle, Lemon Squeezy) only if Stripe formally objects. **Recovery cost:** 2-4 weeks of work; budget for delay if it hits.
- **HPD Registrations data has gaps for newer buildings.** ~5-10% of NYC buildings have stale or missing registrations. Surface this honestly in the AI summary.
- **OpenAI pricing changes break unit economics.** If gpt-4o-mini cost rises >2x, switch lookup pipeline to Claude Haiku 3.5. The lease review pipeline (Phase 4.3) is restricted to US-hosted models for data residency; document any provider switch in `docs/llm-eval.md` and update the privacy policy. **Hard threshold:** if AI cost as % of lease review revenue exceeds 25%, repricing or model swap is forced within 30 days.
- **NYC Open Data API rate limits hit in production.** Negotiate higher token tier with NYC.gov or front the API with more aggressive caching.
- **Supabase free tier limits hit before month 6.** Likely scenario: rapid growth from one viral TikTok. Upgrade to Pro at $25/mo immediately; cost is trivial relative to the user surge.
- **Render free tier cold starts cause user complaints.** Upgrade to Starter ($7/mo) — small price for always-on; do this the day you launch publicly if cold-start UX is a problem.
- **Vercel Hobby ToS becomes an issue (commercial use).** Migrate to Cloudflare Pages (free, no commercial restrictions). Migration is 2-4 hours.
- **Supabase deprecates pg_cron or Edge Functions on free tier.** Unlikely but possible. Migrate crons to external HTTP-trigger services like cron-job.org calling backend endpoints (still free), or upgrade to Supabase Pro early.
- **NY SAFE for Kids Act or NY Child Data Protection Act applicability changes.** RentGuard is a general-audience product not directed at minors, but if regulatory guidance interprets these statutes broadly (e.g., based on inadvertent collection of minors' data), a single-founder product could face compliance overhead it's not architected for. If guidance lands, consult attorney from 0.1; minimum likely measures are an age-attestation gate at signup and adjusted retention for any user who self-identifies as a minor.
- **FTC enforcement action against a comparable consumer-AI legal product.** The *DoNotPay* settlement is the obvious precedent and is referenced directly in the master disclaimer doc preamble. If FTC opens a similar action against another lease-review or FARE Act tool, **trigger Pivot B (FARE Act-only) within 30 days** — strip the lease review, retain only the FARE Act check + complaint letter, and immediately re-test all marketing copy against the "performs like a real lawyer" prohibition.
- **CPRA "sharing" obligation determination on affiliate links.** If attorney from 0.1 concludes affiliate tracking IDs constitute "sharing" under CPRA, add a "Do Not Sell or Share My Personal Information" link in the footer and a global opt-out signal handler. Privacy Policy §9.2 currently asserts no sharing; the assertion has to match reality.
- **Demand letter from a named building owner.** A real possibility given the §1.3 disclaimer-doc risk. If one arrives: pause publication of the named building's report; consult attorney from 0.1; consider stripping owner names and Watchlist surfacing from all reports as a precaution. This is a high-cost mitigation but lower-cost than litigation.

---

## Legal-doc edits required (companion to the v5 alignment pass)

The v5 roadmap aligns with the legal documents on every retention period, every disclaimer surface, and every commitment that should be honored in product behavior. There remain three places where the **legal documents** need to follow the **roadmap's tech choices** — not the other way around. Apply these edits to the legal drafts before attorney review:

### Privacy Policy §2.1 — "Account information"
**Currently reads:** "Email address, password (stored hashed), and any optional profile fields you provide…"
**Should read:** "Email address (used for magic-link sign-in; we do not store passwords), and any optional profile fields you provide…"
**Why:** Phase 2.1 of the roadmap uses Supabase Auth magic-link only. There is no password collection.

### Privacy Policy §2 — Anonymous-flow coverage
**Currently:** §2 talks about account-holders and automatically-collected data; it does not mention email-only or fully-anonymous (anon_token) flows.
**Should add:** a paragraph in §2.1 or as a new §2.4 describing that:
1. Building lookups can be performed without an account (anonymously or after providing only an email for the free-tier counter); the data we hold for those users is the lookup history tied to an `anon_token` browser identifier or to an email.
2. The `email_lookup_counters` table from Phase 1.3 is service-role-only and is purged when the user authenticates or upon account deletion.
3. Anonymous lease-review previews are tied to `anon_token` and email; full unlock requires payment which captures email, then optionally upgrades to a full account.
**Why:** the roadmap deliberately supports a no-signup-required entry point (Phase 3.8, Phase 4.4); the privacy policy should disclose that.

### Privacy Policy §8 — Cookies and analytics
**Currently reads:** "Analytics cookies — to understand product usage in aggregate (we use [ANALYTICS PROVIDER — to be selected by founder; default plan is privacy-respecting Plausible or PostHog with EU/US data residency])."
**Should read:**
> Analytics. We use Cloudflare Web Analytics for page-view analytics; it is cookieless and does not require a banner. We use PostHog for event analytics on paid funnel actions (e.g., paywall views, lease unlocks); PostHog uses a first-party cookie to deduplicate events.
**Why:** Plausible was dropped in the v3 stack rewrite; the production stack is Cloudflare Web Analytics + PostHog. The "Plausible or PostHog" placeholder no longer matches what the product does.

### Optional but recommended: Disclaimer doc §1.2 and §2.2 — source/clause list parity
- **§1.2 (Building Risk Report):** lists six public-record sources. Phase 3.1 actually integrates eight (adds Bedbug Registry and Lead Paint History). Either narrow Phase 3.1 to the disclaimer's six, or add the two missing sources to §1.2. Recommendation: add to §1.2; the bedbug and lead-paint sources are useful product signals.
- **§2.2 (Lease Review):** lists six clause categories including rent-stabilization-misrepresentation and pet-policy/service-animal coverage, both of which are in 4.1b (post-launch). At v1 launch (4.1a only — five clauses), the production-rendered disclaimer should be the v1 variant from `docs/legal/disclaimers-v1.md`. Phase 4.1a now treats this as a launch-blocker checklist item.

### Items already aligned (no edit needed)
- ToS §4.1, §4.2 pricing matches Phase 4.1/5.1.
- ToS §4.3 refund policy is now implemented in Phase 4.6b.
- ToS §11 (arbitration / class waiver) is text-only; no implementation needed.
- ToS §2.2 "What RentGuard is not" is implemented as the per-report footer in Phases 3.9, 4.6, 6.1 (and as the "We Are Not" cross-surface block in disclaimer §5).
- Privacy Policy §4.2 "no model training" is now backed by Phase 0.2 vendor DPA verification.
- Privacy Policy §6.1 retention table is implemented exactly in Phase 8.7.
- Privacy Policy §6.2 per-lease delete is implemented in Phase 8.6.
- Disclaimer §4.1, §4.2 affiliate disclosure is implemented in Phase 8.10.
- Disclaimer §1.3, §2.3, §3.3 pre-output framing is implemented in Phases 3.9, 4.6, 6.1.
- Disclaimer §3.2 DCWP complaint letter language is implemented in Phase 6.2.

After these three edits land in the legal drafts, the four documents (roadmap, disclaimer, privacy policy, ToS) will be internally consistent and ready for the attorney review pass from Phase 0.1.
