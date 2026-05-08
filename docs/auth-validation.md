# RentGuard Auth Validation

Methodology adapted from `authentication-validator` (jeremylongshore/claude-code-plugins-plus-skills); the upstream `npx skillfish add` ran into a GitHub API rate limit, so the checks below were performed manually against the same surface area (token verification, session handling, route gating, cookies, CORS, RLS, secret hygiene, tests).

Date: 2026-05-08
Branch: `claude/validate-rentguard-auth-9PhLH`

## Verdict

**Pass.** RentGuard's auth implementation is sound: Supabase magic-link sign-in on the Next.js side, HS256 JWT verification with `jose` on the Hono backend, RLS enabled on every user-scoped table, and the per-user dashboard / saved-buildings flows are gated correctly. Tests cover the unhappy paths (missing header, invalid token, invalid input) end-to-end and pass (21/21).

A handful of small observations are listed at the bottom; none of them block ship.

## Auth surface area

| Layer | File(s) | Role |
|---|---|---|
| Frontend sign-in | `frontend/app/login/LoginForm.tsx`, `frontend/components/SignInModal.tsx` | Magic-link via `supabase.auth.signInWithOtp` (PKCE) |
| Frontend session | `frontend/lib/supabase/{browser,server,middleware,config}.ts` | `@supabase/ssr` clients; httpOnly cookies on the server |
| Frontend gate | `frontend/middleware.ts` (matcher: `/dashboard/:path*`, `/login`) | Refresh session, redirect unauth → `/login`, auth → `/dashboard` |
| Magic-link callback | `frontend/app/auth/callback/route.ts` (`exchangeCodeForSession`), `frontend/app/auth/confirm/route.ts` (`verifyOtp`) | Redirect target validated against `allowedRedirects` allowlist |
| Frontend → Backend bridge | `frontend/lib/api/backend.ts:authHeader` | Attaches `Authorization: Bearer <access_token>` from `getSession()` |
| Backend JWT | `backend/src/middleware/auth.ts` (`jose.jwtVerify`, HS256, `SUPABASE_JWT_SECRET`) | Optional — sets `userId`/`userEmail` on context when valid; never throws |
| Backend anon | `backend/src/middleware/anon-token.ts` | UUID anon cookie (`rentguard-anon`) for rate-limiting / cost tracking |
| Route gates | `backend/src/routes/saved-buildings.ts`, `backend/src/routes/lookup.ts` | Gate on `c.get('userId')`; saved-buildings 401s without it |
| RLS | `backend/drizzle/{0002,0004,0006,0007}_*.sql`, `0009`, `0011`, `0016` | RLS on every user-scoped table; service-role for inserts |
| Supabase project | `supabase/config.toml` | PKCE flow, refresh-token rotation, redirect allowlist |

## Findings

### 1. JWT verification (backend) — OK
`backend/src/middleware/auth.ts` uses `jose.jwtVerify` against `SUPABASE_JWT_SECRET` with `algorithms: ['HS256']` (algorithm is pinned, so an attacker can't downgrade to `none`). `jose` enforces the `exp` claim by default. Invalid tokens fall through to anonymous — intentional for the optional-auth pattern, and route-level gates (saved-buildings, dashboard) are responsible for returning 401.

### 2. Route gating — OK
- `/v1/saved-buildings` (GET list, GET :bbl, POST, DELETE): all four call `getAuthedUserId(c)` and return `{ kind: 'unauthorized' }` 401 when missing. Verified by 4 dedicated 401 tests.
- `/v1/lookup` and `/v1/lookup/stream`: intentionally optional-auth — anonymous and email-gated flows exist by design (free tier). User identity is read from context for rate-limiting (60/h vs 10/h) and persistence (`buildingLookups.userId`).
- `/v1/building/:bbl`: intentionally public (SEO archive); reads cached data only.
- `/v1/affiliate/click`, `/v1/waitlist/email`: intentionally public.

### 3. Frontend session + Next.js middleware — OK
`frontend/lib/supabase/middleware.ts` calls `supabase.auth.getUser()` (not `getSession()`) for the gate decision, which forces a server-validated round-trip rather than trusting a stale cookie — correct for an SSR auth check. The matcher only covers `/dashboard/:path*` and `/login`, so public pages don't pay the auth round-trip cost. The `getSupabaseUrl()` / `getSupabaseAnonKey()` failure path redirects protected routes to `/login` instead of crashing — good fail-closed behavior.

### 4. Magic-link callback redirect handling — OK
Both `/auth/callback` and `/auth/confirm` validate redirect targets against `allowedRedirects = new Set(['/dashboard'])` and fall back to `/dashboard` on any parse failure. No open-redirect surface. The `redirect_to` parsing in `confirm` constructs a `URL` with the request origin and re-checks `origin === requestUrl.origin`, so an off-host redirect is impossible.

### 5. Cookies — OK
- Frontend Supabase server cookies: `httpOnly: true`, `sameSite: 'lax'`, `secure` in production (`frontend/lib/supabase/config.ts`).
- Backend anon token: `httpOnly: true`, `sameSite: 'Lax'`, `secure` in production, 12-month TTL matching Privacy Policy §6.1.
- Refresh-token rotation enabled (`supabase/config.toml:192`).

### 6. CORS — OK
`backend/src/middleware/cors.ts` locks origins to an explicit allowlist + `https://*.vercel.app` regex, with `credentials: true` and a tight `allowMethods`/`allowHeaders` list. Disallowed origins return `null` (i.e. no `Access-Control-Allow-Origin` header).

### 7. RLS / database — OK
Every user-scoped table has `ENABLE ROW LEVEL SECURITY`:
- `profiles` — `select_own`, `update_own` keyed off `auth.uid() = id`.
- `building_lookups`, `lease_reviews`, `subscriptions` — `select_own` keyed off `auth.uid() = user_id`.
- `email_lookup_counters`, `affiliate_clicks`, `ai_usage`, `non_nyc_waitlist`, `refunds`, `cost_alerts`, `scraped_listings`, `saved_buildings` — RLS enabled with no policies (service-role only).
- `buildings`, `landlords` — public SELECT for anon + authenticated; writes service-role only.
- Storage: `lease-pdfs` SELECT requires `auth.uid()::text = (storage.foldername(name))[1]`; writes service-role only.

Cross-schema FKs to `auth.users` are wired with appropriate `ON DELETE` semantics (CASCADE for profiles + subscriptions, SET NULL for retention-bound rows like refunds and lease reviews).

### 8. Secret hygiene — OK
- `.gitignore` excludes `.env`, `.env.local`, `.env.*.local`; only `.env.example` is tracked.
- `backend/.env.example` and `frontend/.env.example` use placeholder secrets, never real ones.
- `render.yaml` declares all secrets with `sync: false` so they're prompted in the dashboard.
- `SUPABASE_JWT_SECRET` is read once via `process.env` and never logged. The default in `.env.example` is the well-known local-Supabase placeholder, which matches `supabase/config.toml`.

### 9. Tests — Pass
```
backend/test/saved-buildings.test.ts (18 tests) ✓
backend/test/health.test.ts (3 tests) ✓
```
Covered: missing Authorization header → 401, invalid JWT → 401, valid signed JWT → 200, BBL validation → 400, idempotent POST/DELETE, list ordering, LEFT-JOIN nulls. The signing flow uses `jose.SignJWT` against the same `SUPABASE_JWT_SECRET`, so the auth middleware path is exercised end-to-end (no middleware mock).

## Non-blocking observations

These don't block ship — recording them so they're easy to revisit.

1. **Vercel preview wildcard in `additional_redirect_urls`.** `supabase/config.toml:181-183` allowlists `https://*.vercel.app/auth/callback`. Any preview deploy on `*.vercel.app` (RentGuard's or anyone else's) can be the post-magic-link target. Practically bounded by Supabase's exact-match logic and the fact the magic link is single-use, but consider tightening to `https://rentguardai-*.vercel.app` once the project's Vercel namespace is stable.

2. **Symmetric JWT (HS256).** `SUPABASE_JWT_SECRET` is the only thing standing between a leaked secret and forged user tokens. Supabase now offers asymmetric JWT signing (RS256 / ES256) where the backend verifies with a public JWK — worth migrating to once it stabilizes, since it removes a high-value secret from the backend env.

3. **Silent JWT failures.** `backend/src/middleware/auth.ts:18` catches verification failures silently. That's correct for the optional-auth pattern, but a `logger.debug({ err }, 'jwt verify failed')` would help triage "why does this user keep appearing as anon?" support tickets without leaking PII.

4. **CORS `*` for empty Origin.** `backend/src/middleware/cors.ts:17` returns `'*'` when `Origin` is missing. Browsers can't send credentialed requests with a `*` ACAO, so the practical surface is just non-browser tools (curl / server-to-server). The endpoints already require a Bearer token for sensitive routes, so this is fine — flagging for awareness.

5. **Public-routes session refresh.** `frontend/middleware.ts` only matches `/dashboard/:path*` and `/login`, so public pages don't refresh the Supabase session cookie. The browser client (`supabase.auth.getSession()` inside `authHeader()` and `SignInModal`) handles refresh client-side, which works because magic-link flows are short-lived. If we ever add long-lived authenticated server-rendered pages outside `/dashboard`, the matcher will need to grow.

## How to re-run

```bash
cd backend
npm ci
npx vitest run test/saved-buildings.test.ts test/health.test.ts
```

To re-validate the magic-link flow end-to-end:
1. `supabase start` (uses `supabase/config.toml`)
2. `cd backend && npm run dev`
3. `cd frontend && npm run dev`
4. Visit `http://localhost:3000/login`, submit an email, open the inbucket UI at `http://localhost:54324`, click the magic link, confirm redirect to `/dashboard`.
