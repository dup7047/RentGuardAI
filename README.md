# RentGuard NYC

AI-powered NYC rental copilot. Helps renters avoid bad apartments by analyzing listings, buildings, landlords, and leases against NYC public records and tenant law.

This repository follows the phased plan in `RENTGUARD_ROADMAP_v6.md` (kept outside the repo). Current state: through **Phase 1.3 — User-table schema + RLS policies**.

## Layout

```
RentGuardAI/
├── backend/                  # Hono.js API on Render free tier
│   ├── src/
│   │   ├── app.ts            # Hono app + middleware wiring
│   │   ├── server.ts         # @hono/node-server entry point
│   │   ├── logger.ts         # pino instance
│   │   ├── commit.ts         # git SHA resolution
│   │   ├── middleware/       # request logger
│   │   └── db/               # drizzle client + migrate runner + (empty) schema
│   ├── drizzle/              # migrations folder (committed; tracked by drizzle-kit)
│   ├── test/                 # vitest unit + integration tests
│   ├── drizzle.config.ts
│   └── package.json
├── supabase/                 # Local Supabase stack config (supabase init)
│   └── config.toml
├── .github/workflows/        # CI: typecheck, build, migrate against local Supabase
├── render.yaml               # Render service definition
└── README.md
```

A `frontend/` (Next.js on Vercel) will land in a later phase.

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
