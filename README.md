# RentGuard NYC

AI-powered NYC rental copilot. Helps renters avoid bad apartments by analyzing listings, buildings, landlords, and leases against NYC public records and tenant law.

This repository follows the phased plan in `RENTGUARD_ROADMAP_v6.md` (kept outside the repo). Current state: foundation complete — backend schema and storage through **Phase 1.7**, identity wired through **Phase 2.1 — Supabase Auth + Next.js client**. Phase 0 prerequisites: NYC Open Data verifier (0.3) and Stripe setup script (0.4) committed; legal docs (0.1) and staging Supabase (0.2 follow-up) still pending.

## Layout

```
RentGuardAI/
├── backend/                  # Hono.js API on Render free tier
│   ├── src/                  # Hono app, pino logger, commit resolver, db client, middleware
│   ├── drizzle/              # migrations folder (committed; tracked by drizzle-kit)
│   ├── test/                 # vitest unit + integration tests
│   ├── scripts/              # verify-restore, verify-data-sources (0.3), stripe-setup (0.4)
│   ├── RUNBOOK.md            # backup/restore procedures (Phase 1.7)
│   ├── drizzle.config.ts
│   └── package.json
├── frontend/                 # Next.js 15 on Vercel (Phase 2.1: magic-link auth)
│   ├── app/                  # /login, /dashboard, /auth/callback, /auth/confirm
│   ├── lib/supabase/         # browser, server, middleware, config helpers (@supabase/ssr)
│   ├── middleware.ts         # session refresh + route guards
│   └── package.json
├── supabase/
│   ├── config.toml           # local CLI config (auth templates, redirect URLs)
│   └── templates/            # branded magic-link.html and confirmation.html
├── docs/
│   ├── data-sources.md       # NYC Open Data inventory (Phase 0.3)
│   ├── nyc-open-data-token.md
│   ├── stripe-setup.md       # Phase 0.4 manual + scripted setup
│   └── runbook/auth-limits.md  # Supabase Auth rate-limit doc (Phase 2.1)
├── .github/workflows/        # CI: typecheck, build, migrate against local Supabase
├── render.yaml               # Render service definition
└── README.md
```

## Backend — local development

Requires:

- Node 20+
- Docker Desktop (for the local Supabase stack)
- Supabase CLI — install via `brew install supabase/tap/supabase` or grab a binary from <https://github.com/supabase/cli/releases>

### First-time setup

```sh
# 1. Bring up the local Supabase stack (Postgres on :54322, Studio on :54323)
supabase start

# 2. Install backend deps + apply migrations
cd backend
cp .env.example .env
npm install
npm run migrate        # applies drizzle/*.sql against local Supabase
```

### Day-to-day

```sh
cd backend
npm run dev            # tsx watch on http://localhost:8080
npm test               # vitest (skips DB integration tests if DATABASE_URL is unset)
npm run typecheck      # tsc --noEmit
```

Verify the health endpoint:

```sh
curl -s http://localhost:8080/health
# → {"status":"ok","commit":"<git sha>"}
```

### Database changes

Schema lives in `backend/src/db/schema.ts`. Cross-schema FKs into `auth.users` and RLS policies live in hand-written `--custom` migrations alongside the generated ones (the security migration for Phase 1.3 is `drizzle/0002_phase_1_3_security.sql`).

To add tables:

```sh
cd backend
npm run db:generate    # diffs schema.ts vs the snapshot, writes a new drizzle/NNNN_*.sql
npm run migrate        # applies pending migrations
```

Studio for browsing data: <http://127.0.0.1:54323> (after `supabase start`).

### Pointing at staging or production Supabase

The `migrate` script reads `DATABASE_URL` from the environment. For staging/prod, paste the connection string from the Supabase project's **Settings → Database**:

```sh
DATABASE_URL='postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres' \
  npm run migrate
```

The pg client auto-enables SSL when the URL contains `supabase.co` or `sslmode=require`.

## Deployment (Render free tier)

The `render.yaml` blueprint at the repo root provisions a single web service named `rentguard-backend` from `backend/`. Render injects `RENDER_GIT_COMMIT`, which the backend reports via `/health`.

To wire it up:

1. In the Render dashboard, choose **New → Blueprint** and point at this repo.
2. Render reads `render.yaml` and creates the service.
3. After the first deploy, hit `https://<your-service>.onrender.com/health` — expect a 200 with the deployed commit SHA. The free tier spins down when idle, so the first request after a quiet period takes ~30 seconds; subsequent requests are fast.

Frontends should retry the first call once on cold start.

## Frontend — local development

The Next.js 15 app under `frontend/` runs the marketing landing page and the Phase 2.1 Supabase Auth UI (`/login`, `/auth/callback`, `/auth/confirm`, `/dashboard`).

```sh
cd frontend
cp .env.example .env.local
npm install
npm run dev            # http://localhost:3000
npm test               # Vitest component/unit tests
npm run e2e:smoke      # Playwright smoke matrix with mocked backend fixtures
```

The dev server expects Supabase to be running locally on `http://127.0.0.1:54321` (started with `supabase start` from the repo root). Magic-link emails route to Inbucket at <http://127.0.0.1:54324> for inspection.

Production deploys to Vercel from the `main` branch; project Root Directory must be set to `frontend/`. Supabase env vars (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`) are configured under Project Settings → Environment Variables.

UI launch readiness is gated by the browser matrix in `docs/ui-testing-checklist.md`.

## Operational scripts

All run from `backend/`:

```sh
npm run verify:restore       # 44 post-restore assertions (Phase 1.7)
npm run verify:data-sources  # hits 8 NYC Open Data endpoints, asserts shape (Phase 0.3)
npm run stripe:setup         # idempotent Stripe products + prices + portal + webhook (Phase 0.4)
npm run stripe:setup:dry-run # same, but blocks all writes
```

The `stripe:setup` script refuses `sk_live_*` keys (test mode only) and outputs the env vars needed for Render.

## Phase acceptance checklist

### Phase 1.1 — Hono backend scaffold
- [x] `npm test` passes (smoke test for `/health`)
- [x] Logs are JSON-structured with a `requestId` per request (method, path, status, durationMs)
- [x] Render blueprint provisions the service and wires the health check
- [ ] `curl <render-url>/health` returns 200 — pending first deploy by the operator (Render account access required)

### Phase 1.2 — Drizzle + Supabase CLI
- [x] `supabase start` brings up the local stack (Postgres on :54322 with Supabase's `auth.*` schema pre-populated)
- [x] `npm run migrate` applies the baseline migration to local Supabase, recording it in `drizzle.__drizzle_migrations`
- [x] Re-running `npm run migrate` is a no-op (idempotent)
- [x] CI workflow (`.github/workflows/backend-ci.yml`) boots a local Supabase via `supabase/setup-cli` and runs the migration flow on every PR
- [ ] `npm run migrate` against staging Supabase succeeds — pending staging Supabase project (Phase 0.2 prerequisite, operator action)

### Phase 1.3 — User tables + RLS
- [x] `profiles`, `email_lookup_counters`, `building_lookups`, `lease_reviews` migrated via Drizzle
- [x] `profiles.id` FK → `auth.users(id)` ON DELETE CASCADE; `building_lookups.user_id` and `lease_reviews.user_id` ON DELETE SET NULL — verified by integration tests that delete an `auth.users` row and assert the cascade/null behavior
- [x] RLS enabled on all four tables; `email_lookup_counters` has no policies (service-role only); `profiles`/`building_lookups`/`lease_reviews` have own-row SELECT policies (and own-row UPDATE on `profiles`)
- [x] Integration tests cover RLS denial under both `anon` and `authenticated` Postgres roles using `set_config('request.jwt.claims', …, true)` so `auth.uid()` resolves correctly
- [x] PDF-purge pattern verified: nulling `pdf_storage_path` and `extracted_text` while setting `pdf_deleted_at` preserves the structured `ai_report` (Privacy Policy §6.1)
- [ ] `npm run migrate` applied against staging Supabase — pending staging project

### Phase 1.4 — Cache tables (buildings, landlords)
- [x] `buildings` (bbl PK, address, borough, last_fetched_at, raw_data jsonb default `{}`) migrated via Drizzle
- [x] `landlords` (id PK, registered_owner_name, hpd_corporation_name, watchlist_rank nullable, last_fetched_at) migrated via Drizzle
- [x] Deferred `building_lookups.building_bbl` FK → `buildings(bbl)` ON DELETE SET NULL added now that `buildings` exists
- [x] RLS enabled on both cache tables with public-read SELECT policies for `anon` + `authenticated`; no INSERT/UPDATE/DELETE policies, so writes are restricted to the service role (BYPASSRLS)
- [x] Integration tests cover anon SELECT works on both tables; anon INSERT/UPDATE/DELETE are blocked; the FK rejects orphan `building_lookups`, allows null `building_bbl`, and SET NULLs the column when the cached building is deleted; service-role upsert + default UUID work
- [ ] `npm run migrate` applied against staging Supabase — pending staging project (Phase 1.4)

### Phase 1.5 — Schema: subscriptions, affiliate_clicks, ai_usage, non_nyc_waitlist, refunds
- [x] `subscriptions` (id, user_id FK → auth.users CASCADE, stripe_subscription_id unique, status enum, current_period_end, created_at) migrated via Drizzle
- [x] `affiliate_clicks` (id, user_id nullable, anon_token nullable, partner enum [lemonade, bellhop, moved], referrer_url, clicked_modal_at, clicked_through_at nullable, converted_at nullable, commission_amount_cents nullable) migrated
- [x] `ai_usage` (id, user_id nullable, email nullable, route enum [lookup, lease_preview, lease_full], cost_cents, model_used, created_at) migrated
- [x] `non_nyc_waitlist` (id, email, attempted_address, requested_city, requested_state, created_at) migrated
- [x] `refunds` (id, user_id nullable → auth.users SET NULL, lease_review_id nullable → lease_reviews SET NULL, subscription_id nullable → subscriptions SET NULL, stripe_refund_id unique, amount_cents, eligibility_reason, created_at) migrated
- [x] RLS enabled on all five tables; `subscriptions` has an own-row SELECT policy for `authenticated`; the other four are service-role-only (no policies → BYPASSRLS required for all access)
- [x] Integration tests cover: affiliate click → click-through → conversion lifecycle; ai_usage rows with and without user_id; non_nyc_waitlist insert; refund writeable by service role + user_id SET NULL on account deletion; subscriptions CASCADE delete; RLS denial for anon + authenticated on service-role-only tables; own-row SELECT isolation on subscriptions
- [ ] `npm run migrate` applied against staging Supabase — pending staging project (Phase 1.5)

### Phase 1.6 — Supabase Storage buckets + policies
- [x] `lease-pdfs` bucket created (private, 50 MB limit, `application/pdf` MIME only)
- [x] `firm-logos` bucket created (public, 5 MB limit, image MIME types)
- [x] `lease_pdfs_select_own` policy: authenticated users can SELECT objects where `auth.uid()::text = (storage.foldername(name))[1]` — own user-ID folder only; anonymous users have no SELECT policy (access via signed URL only)
- [x] `firm_logos_select_public` policy: anon + authenticated can SELECT all firm-logos objects (public read for B2B Phase 7)
- [x] No INSERT/UPDATE/DELETE policies on `storage.objects` — all writes are service-role only (BYPASSRLS)
- [x] 23 integration tests covering: bucket existence + settings, policy shape, service-role HTTP upload (with MIME enforcement), anon download blocked on lease-pdfs, anon download allowed on firm-logos, public `/object/public/` URL, signed download URL generation + unauthenticated access, signed upload URL generation, SQL user isolation (user A can read own, user B cannot, anon cannot), public bucket readable by both roles, anon INSERT blocked
- [ ] `npm run migrate` applied against staging Supabase — pending staging project (Phase 1.6)

### Phase 1.7 — Backup verification
- [x] `backend/RUNBOOK.md` documents backup strategy, local and cloud restore procedures, post-restore verification steps, and RTO/RPO targets
- [x] `npm run verify:restore` script added — 44 checks across 8 categories (tables, RLS, enums, FKs, migrations, storage buckets + policies, auth schema)
- [x] Full restore drill performed (2026-05-06): `supabase db reset` wiped local database → `npm run migrate` replayed all 8 migrations → `verify:restore` passed (44/44) → full test suite passed (104/104) in under 5 minutes
- [x] Findings documented in RUNBOOK §8: seed.sql warning is harmless; storage trigger survives reset; Drizzle migration table is recreated cleanly

### Phase 2.1 — Supabase Auth + Next.js client integration
- [x] `@supabase/ssr` and `@supabase/supabase-js` added to `frontend/package.json`
- [x] SSR client helpers in `frontend/lib/supabase/`: `browser.ts` (PKCE), `server.ts` (Server Components), `middleware.ts` (session refresh + route guards), `config.ts` (env helpers + cookie options)
- [x] Custom auth cookie name `rentguard-auth`; `httpOnly` on the server-side variant; `secure` only in production; `sameSite=lax`
- [x] `frontend/middleware.ts` runs on `/dashboard/:path*` and `/login`; redirects unauthed → `/login?redirectTo=…`; redirects authed away from `/login` → `/dashboard`; falls back gracefully when env vars missing on public routes
- [x] `frontend/app/login/page.tsx` + `LoginForm.tsx` — `signInWithOtp` with `emailRedirectTo` set to `/auth/callback?next=…`; surfaces success/error states and `redirectTo`/`loggedOut`/`authError` banners
- [x] `frontend/app/auth/callback/route.ts` — PKCE code exchange via `exchangeCodeForSession`; allowlisted redirect targets only
- [x] `frontend/app/auth/confirm/route.ts` — token-hash verification via `verifyOtp` for magic-link emails (server-side, more secure than client-side hash exchange)
- [x] `frontend/app/dashboard/page.tsx` (Server Component) and `actions.ts` (sign-out server action) — auth-gated, redirects to `/login?redirectTo=/dashboard` if no user
- [x] `supabase/templates/magic-link.html` and `confirmation.html` — branded RentGuard NYC copy; both link to `/auth/confirm?token_hash=…&type=…&next=/dashboard`
- [x] `supabase/config.toml` — `[auth.email.template.magic_link]` and `[auth.email.template.confirmation]` wired; `additional_redirect_urls` includes localhost (3000+3100), `rentguard.cc`, `www.rentguard.cc`, and `*.vercel.app` for both `/auth/callback` and `/auth/confirm`
- [x] `docs/runbook/auth-limits.md` — documents Supabase Auth rate-limit defaults and the staging checklist (Resend SMTP, redirect allow-list, branded templates, end-to-end manual test)
- [x] Landing page (`frontend/app/page.tsx`) replaces "Launching Soon" with a real Sign In CTA pointing at `/login`
- [ ] Vercel project: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` set under Project Settings → Environment Variables — pending operator
- [ ] `[auth.email.smtp]` block in `supabase/config.toml` enabled with Resend creds — pending staging Supabase + RESEND_API_KEY
- [ ] End-to-end manual test on staging (email → Resend-routed branded email → magic link → dashboard → log out) — pending staging project
