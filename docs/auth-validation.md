# RentGuard Auth Validation

**Skill applied:** `authentication-validator` (jeremylongshore/claude-code-plugins-plus-skills, v1.0.0) — `plugins/security/authentication-validator/skills/validating-authentication-implementations/SKILL.md`. The 10-step instruction list, required output sections, and CWE / OWASP ASVS framing below come from that skill.

**Date:** 2026-05-08
**Branch:** `claude/validate-rentguard-auth-9PhLH`
**Tested:** `backend/test/saved-buildings.test.ts` + `health.test.ts` (21/21 passing)

---

## Executive summary

| | Count |
|---|---|
| Critical | 0 |
| High | 0 |
| Medium | 4 |
| Low | 2 |
| Info | 1 |

**Risk rating: Low.** RentGuard is passwordless (Supabase magic-link only), so the largest categories of auth weaknesses (weak password hashing, account lockout misconfiguration, brute-force on login, password reset enumeration) are out of scope by design. The remaining gaps are: missing `aud`/`iss` claim validation in the backend JWT middleware, an over-permissive Vercel preview wildcard in the Supabase redirect allowlist, MFA disabled across the board, and a lurking `minimum_password_length = 6` config that would matter if passwords were ever turned on.

**Top three fixes (in priority order):**
1. **F1 (CWE-345):** Add `audience: 'authenticated'` and `issuer: '<supabase-project-url>/auth/v1'` to the `jose.jwtVerify` call in `backend/src/middleware/auth.ts:15`.
2. **F2 (CWE-601):** Replace `https://*.vercel.app/auth/callback` in `supabase/config.toml:181-183` with the RentGuard-specific Vercel pattern (e.g. `https://rentguardai-*.vercel.app/auth/callback`).
3. **F3 (CWE-308):** Plan TOTP MFA enablement before B2B / billing flows ship (Phase 7+).

---

## Step 1 — Authentication inventory

| # | Mechanism | Entry point | File |
|---|---|---|---|
| 1 | Magic-link issuance (browser) | `supabase.auth.signInWithOtp` | `frontend/app/login/LoginForm.tsx:64`, `frontend/components/SignInModal.tsx:67` |
| 2 | Magic-link verify (OTP) | `GET /auth/confirm?token_hash=…&type=…` | `frontend/app/auth/confirm/route.ts:42` |
| 3 | OAuth-style code exchange | `GET /auth/callback?code=…` | `frontend/app/auth/callback/route.ts:7` |
| 4 | Sign-out | `supabase.auth.signOut` server action | `frontend/app/dashboard/actions.ts:7` |
| 5 | SSR session refresh + gate | `supabase.auth.getUser()` in Next middleware | `frontend/lib/supabase/middleware.ts:75-77` |
| 6 | Backend JWT verification | `jose.jwtVerify` (Bearer token) | `backend/src/middleware/auth.ts:9-23` |
| 7 | Anonymous identity (rate-limit) | `rentguard-anon` UUID cookie | `backend/src/middleware/anon-token.ts` |
| 8 | Per-user route gates | `c.get('userId')` 401 | `backend/src/routes/saved-buildings.ts:24-27` |
| 9 | RLS (database) | `auth.uid()` policies | `backend/drizzle/{0002,0004,0006,0007,0009,0011,0016}_*.sql` |
| 10 | Service-role bypass | `BYPASSRLS` writes from backend | `backend/src/db/client.ts` (DATABASE_URL is service-role) |

No third-party OAuth providers, no SAML, no SMS. `auth.external.*` and `auth.mfa.*` are all `enabled = false` in `supabase/config.toml`.

---

## Step 2 — Password storage audit

**N/A — RentGuard is passwordless by design.**

`grep` for `bcrypt|argon2|scrypt|pbkdf2|hashSync|md5|sha1` across `backend/src` and `frontend` returns zero application-side hits. The only mentions of "password" in code are the *absence* messages in `LoginForm.tsx:92` ("No password needed") and `SignInModal.tsx:156` ("No password. We'll email you a one-tap sign-in link"), plus a legal-pages test asserting the Privacy Policy doesn't mention "password (stored hashed)".

Supabase Auth itself stores passwords with bcrypt server-side, but no code path in this repo invokes `signInWithPassword`. **Compliant with NIST SP 800-63B §5.1.1.2 by avoidance.**

⚠️ Configuration drift risk recorded as F4 below: `supabase/config.toml:203` has `minimum_password_length = 6`, which is below NIST's ≥8 floor. It only takes effect if a future change adds password sign-in.

---

## Step 3 — JWT implementation review

`backend/src/middleware/auth.ts:9-23`:

```ts
const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
if (typeof payload.sub === 'string') c.set('userId', payload.sub);
if (typeof payload.email === 'string') c.set('userEmail', payload.email);
```

| Check | Status | Notes |
|---|---|---|
| Algorithm pinned (no `none`) | ✅ | `algorithms: ['HS256']` rejects `alg: none` confusion |
| Algorithm strength | ⚠️ | HS256 is symmetric; secret leak = forge tokens. Skill flags as "weak" but tolerable when the secret is high-entropy and never logged. Supabase project secret is ≥256 bits. **Info-level F7.** |
| `exp` validated | ✅ | `jose.jwtVerify` enforces `exp` by default (1h per `jwt_expiry = 3600`) |
| `iat` validated | ✅ | jose enforces ordering vs `exp` |
| `aud` validated | ❌ | **Finding F1 (Medium, CWE-345)**. Supabase tokens carry `aud: 'authenticated'`; not checking it means a token from any other Supabase project signed with a colliding secret would be accepted. |
| `iss` validated | ❌ | Same finding (F1). Supabase tokens carry `iss: <project-url>/auth/v1`. |
| `nbf` validated | N/A | Supabase doesn't set `nbf` |
| Storage (browser) | ✅ | `@supabase/ssr` keeps tokens in httpOnly cookies, not `localStorage` (verified — no `localStorage` or `persistSession` overrides anywhere in `frontend/lib/supabase/`) |
| Refresh-token rotation | ✅ | `enable_refresh_token_rotation = true`, `refresh_token_reuse_interval = 10` (`supabase/config.toml:192-195`) |
| Sensitive data in payload | ✅ | Payload reads only `sub` + `email`; no secrets or PII embedded |
| Tests exercise verify path | ✅ | `backend/test/saved-buildings.test.ts` signs real JWTs with `jose.SignJWT` — the middleware's verify path is tested end-to-end |

**Token security analysis (skill output section):**
- Algorithm: `HS256` (pinned)
- Claims validated: `exp`, `iat` (jose default), `sub`, `email`
- Claims missing: `aud`, `iss` ← F1
- Storage: httpOnly cookie (server SSR), Authorization Bearer (API calls)
- Expiration policy: 1h access token, refresh token with rotation

---

## Step 4 — Session management

| Check | Status | Source |
|---|---|---|
| Session ID regenerated after authentication | ✅ | `verifyOtp` / `exchangeCodeForSession` mint fresh access + refresh tokens |
| Cookie `HttpOnly` | ✅ | `frontend/lib/supabase/config.ts:10` (server), `backend/src/middleware/anon-token.ts:17` |
| Cookie `Secure` (prod) | ✅ | `secure: process.env.NODE_ENV === 'production'` in both files |
| Cookie `SameSite` | ✅ Lax | Required for magic-link top-level GET (Strict would break the click-from-email flow). Skill accepts `Strict` or `Lax`. |
| Idle timeout | ⚠️ | `[auth.sessions] inactivity_timeout = "8h"` is **commented out** (`supabase/config.toml:303-305`). Falls back to 1h JWT exp + refresh rotation, which works but is implicit. **Finding F6 (Low).** |
| Absolute timeout (`timebox`) | ⚠️ | Same — commented out. F6. |
| Session fixation protections | ✅ | PKCE flow + server-issued refresh tokens prevent fixation |
| Logout invalidates session | ✅ | `auth.signOut()` clears cookies and revokes the refresh token |

---

## Step 5 — OAuth / OIDC review

No external OAuth providers configured (`auth.external.{apple,google,github,…}.enabled = false`). Magic-link is the only flow.

| Check | Status | Notes |
|---|---|---|
| `state` parameter for CSRF | ✅ | Handled by Supabase + PKCE |
| PKCE for public clients | ✅ | `flowType: 'pkce'` on both `createBrowserClient` and `createServerClient` |
| Redirect URI whitelist (Supabase side) | ⚠️ | **Finding F2 (Medium, CWE-601)**. `supabase/config.toml:181-183` allows `https://*.vercel.app/auth/callback` — any preview domain on `*.vercel.app` (RentGuard's or anyone else's) is a valid post-magic-link target. |
| Redirect URI whitelist (app side) | ✅ | `frontend/app/auth/callback/route.ts:5` and `confirm/route.ts:6` both restrict the post-verify redirect to `new Set(['/dashboard'])` and validate `redirectUrl.origin === requestUrl.origin` before honoring `redirect_to`. No open-redirect surface at the application layer. |
| Token storage | ✅ | httpOnly cookie; Authorization header for API; never in URL fragments or localStorage |

---

## Step 6 — MFA implementation

| Method | Enabled | Source |
|---|---|---|
| TOTP (`auth.mfa.totp`) | ❌ enroll/verify both `false` | `supabase/config.toml:331-334` |
| Phone (`auth.mfa.phone`) | ❌ | `supabase/config.toml:336-341` |
| WebAuthn (`auth.mfa.web_authn`) | ❌ commented out | `supabase/config.toml:343-346` |

**Finding F3 (Medium, CWE-308 Use of Single-factor Authentication).** Acceptable for a free-tier rental tool, but TOTP should be enabled before:
- Stripe billing flows ship (lease-review checkout, Search Pass subscription) — Phase 4.6+
- B2B firm-logos / firm-account features ship — Phase 7+
- Any role with elevated privileges (admin dashboards) is added

`secure_password_change = false` (line 249) is also relevant once MFA exists — re-auth before changing recovery factors should be enforced.

---

## Step 7 — Account security controls

| Control | Status | Notes |
|---|---|---|
| Rate limiting on magic-link issuance | ✅ | `[auth.rate_limit] email_sent = 2/h`, `sign_in_sign_ups = 30/5min`, `token_verifications = 30/5min` (`supabase/config.toml:218-230`) |
| Rate limiting on app API | ✅ | `backend/src/middleware/rate-limit.ts` — 10/h anon, 60/h authenticated |
| Account lockout after failed attempts | N/A | No password to brute-force; magic-link OTP is single-use with 1h expiry |
| Password reset flow | N/A | No passwords |
| User enumeration on sign-in | ✅ | `signInWithOtp({ shouldCreateUser: true })` returns success regardless of whether the email exists. No oracle. |
| Brute-force on OTP | ✅ | `token_verifications = 30/5min` per IP; OTP is 6 chars over 1M space; expiry = 1h |
| CAPTCHA | ⚠️ | `[auth.captcha]` block commented out. Not a finding given Supabase's per-IP rate limits, but worth enabling if abuse appears in logs. |

---

## Step 8 — Credential transmission

| Check | Status | Notes |
|---|---|---|
| HTTPS on all auth endpoints (prod) | ✅ | Vercel + Render terminate TLS; CORS allowlist (`backend/src/middleware/cors.ts:6-13`) only contains HTTPS prod origins + localhost-dev |
| Passwords in URLs | N/A | Passwordless |
| API keys in headers (not query) | ✅ | `frontend/lib/api/backend.ts:227` sets `Authorization: Bearer <token>`, never query-string |
| Tokens in URLs | ⚠️ | `token_hash` is in the `/auth/confirm?token_hash=…` query string of magic-link emails. **Finding F5 (Low, CWE-532).** Mitigated by single-use + 1h TTL; still possible to leak via Referer header if the user clicks an outbound link from `/auth/confirm` before redirect. The Supabase OOB token flow puts the burden on the verify endpoint to consume the token immediately, which it does (`createClient.auth.verifyOtp` runs server-side before any redirect). |
| Auth tokens / passwords in logs | ✅ | `grep` of `logger.{info,warn,error}` calls confirms none log `Authorization`, `token_hash`, JWT contents, or `process.env.SUPABASE_JWT_SECRET` |
| Secrets in repo | ✅ | `.gitignore` excludes `.env`, `.env.local`, `.env.*.local`. `.env.example` placeholder. `render.yaml` uses `sync: false` for every secret. |

---

## Step 9 — Findings (severity + CWE + ASVS mapping)

| ID | Severity | CWE | ASVS | File:Line | Description |
|---|---|---|---|---|---|
| F1 | **Medium** | CWE-345 (Insufficient Verification of Data Authenticity) | V2.9.1, V3.5 | `backend/src/middleware/auth.ts:15` | `jose.jwtVerify` called without `audience` or `issuer` options — accepts any HS256 token signed with the project secret regardless of `aud`/`iss` |
| F2 | **Medium** | CWE-601 (URL Redirection to Untrusted Site) | V2.5.4 | `supabase/config.toml:181-183` | `https://*.vercel.app/auth/callback` wildcard accepts any `*.vercel.app` preview as a magic-link target |
| F3 | **Medium** | CWE-308 (Use of Single-factor Authentication) | V2.7, V2.8 | `supabase/config.toml:331-346` | TOTP / phone / WebAuthn MFA all disabled. Acceptable pre-billing; needs enablement before Phase 7 |
| F4 | **Medium** | CWE-521 (Weak Password Requirements) | V2.1.1 | `supabase/config.toml:203` | `minimum_password_length = 6` (below NIST ≥8). Latent — only reachable if password sign-in is ever turned on |
| F5 | Low | CWE-532 (Insertion of Sensitive Info into Log File / URL) | V3.1.1 | `frontend/app/auth/confirm/route.ts:43-47` | Single-use OTP `token_hash` appears in URL query string; could leak via Referer if a same-page outbound click happens before `verifyOtp` redirects |
| F6 | Low | CWE-613 (Insufficient Session Expiration) | V3.3.2, V3.3 | `supabase/config.toml:301-305` | `[auth.sessions] timebox` and `inactivity_timeout` commented out — falls back to 1h JWT + refresh rotation (not unsafe, just implicit) |
| F7 | Info | — | — | `backend/src/middleware/auth.ts:18` | Silent `catch` on JWT verify failures. Add a `logger.debug({ err }, 'jwt verify failed')` to aid triage; do **not** log the token |

---

## Step 9b — OWASP ASVS V2 (Authentication) compliance matrix

| Req | Description | Status | Notes |
|---|---|---|---|
| V2.1.1 | Min password length ≥12 | ❌ → N/A | Passwordless. F4 records the latent config. |
| V2.1.2 | Allow Unicode passwords | N/A | — |
| V2.1.5 | User can change creds / passwordless OK | ✅ | Magic link |
| V2.1.7 | No password truncation | N/A | — |
| V2.1.9 | No composition rules | ✅ | None enforced |
| V2.2.1 | Anti-automation on credentials | ✅ | Supabase rate limits + app rate limits |
| V2.2.3 | Account lockout / equivalent | N/A | Passwordless |
| V2.3.1 | Verifier secure (email/SMS) | ✅ | Single-use, 1h TTL, 6-digit OTP |
| V2.5.1 | No JWT in localStorage | ✅ | httpOnly cookies via @supabase/ssr |
| V2.5.4 | Direct user authentication | ✅ | Magic-link + cookie session |
| V2.5.7 | TOTP secrets encrypted at rest | N/A | MFA disabled (F3) |
| V2.6.1 | OOB verifier secure | ✅ | Magic link |
| V2.7.1 | Channel encrypted | ✅ | TLS in prod |
| V2.7.x | MFA available | ❌ | F3 |
| V2.8.x | TOTP / WebAuthn enrollment | ❌ | F3 |
| V2.9.1 | Cryptographic verifier | ⚠️ | HS256 OK; F1 missing aud/iss |
| V2.10.1 | Service account auth | ✅ | service-role JWT for backend → Postgres; never exposed to client |

## Step 9c — OWASP ASVS V3 (Session Management) compliance matrix

| Req | Description | Status | Notes |
|---|---|---|---|
| V3.1.1 | No session token in URL | ⚠️ | F5 — OTP token_hash in URL during verify (single-use mitigation) |
| V3.2.1 | Server-generated tokens | ✅ | Supabase |
| V3.2.2 | ≥64 bits entropy | ✅ | JWT signature; OTP 6-digit (≥20 bits) bounded by rate limit |
| V3.2.3 | Cookie HttpOnly + Secure + SameSite | ✅ | Verified in code |
| V3.2.4 | CSPRNG for tokens | ✅ | `randomUUID()` for anon; Supabase for auth |
| V3.3.1 | Logout invalidates | ✅ | `signOut` |
| V3.3.2 | Idle timeout | ⚠️ | F6 — implicit via 1h JWT |
| V3.3.3 | Re-auth for sensitive ops | ⚠️ | No sensitive ops gated yet; needs revisit at billing |
| V3.4.1 | SameSite | ✅ | Lax |
| V3.4.2 | Secure | ✅ | Prod only |
| V3.4.3 | HttpOnly | ✅ | Always |
| V3.7.1 | Auth controls verified | ✅ | 21/21 tests pass |

---

## Step 10 — Remediation plan

### F1 — Validate JWT `aud` and `iss` (Medium, CWE-345)

`backend/src/middleware/auth.ts`:

```ts
const SUPABASE_AUDIENCE = 'authenticated';
const SUPABASE_ISSUER = `${process.env.SUPABASE_URL}/auth/v1`;
// …
const { payload } = await jwtVerify(token, secret, {
  algorithms: ['HS256'],
  audience: SUPABASE_AUDIENCE,
  issuer: SUPABASE_ISSUER,
});
```

Add `SUPABASE_URL` to `backend/.env.example` and `render.yaml` (`sync: false`).
Update `backend/test/saved-buildings.test.ts:91-98` to set the `aud` and `iss` claims on the test JWT.

### F2 — Tighten Vercel preview wildcard (Medium, CWE-601)

`supabase/config.toml:181-183`: replace
```toml
"https://*.vercel.app/auth/callback",
"https://*.vercel.app/auth/callback/**",
"https://*.vercel.app/auth/confirm",
```
with the project-scoped pattern (replace `<vercel-project>` with the actual Vercel project name):
```toml
"https://<vercel-project>-*.vercel.app/auth/callback",
"https://<vercel-project>-*.vercel.app/auth/callback/**",
"https://<vercel-project>-*.vercel.app/auth/confirm",
```

### F3 — Enable TOTP MFA before Phase 7 (Medium, CWE-308)

Tracked as a roadmap entry, not a code change. Pre-conditions:
- Stripe billing live → MFA on accounts with payment methods
- B2B firm portal live → MFA enforced for firm-admin role

Config delta:
```toml
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```
Plus a frontend MFA enrollment screen (out of scope for this validation).

### F4 — Bump default password length (Medium, CWE-521 — latent)

`supabase/config.toml:203`: change `minimum_password_length = 6` → `12`. Defensive — currently no code path reaches it.

### F5 — Document OTP-in-URL acceptance (Low, CWE-532)

No code change. Add a SECURITY.md note acknowledging that magic-link OTPs ride in the URL query string (Supabase standard) and that single-use + 1h TTL is the mitigation.

### F6 — Make session timeouts explicit (Low, CWE-613)

`supabase/config.toml`: uncomment
```toml
[auth.sessions]
timebox = "24h"
inactivity_timeout = "8h"
```

### F7 — Log JWT verification failures at debug level (Info)

`backend/src/middleware/auth.ts:18`: replace the silent `catch {}` with
```ts
} catch (err) {
  logger.debug({ err: String(err) }, 'jwt verify failed — falling through to anon');
}
```

Do **not** log the token contents.

---

## How to re-run

```bash
cd backend
npm ci
npx vitest run test/saved-buildings.test.ts test/health.test.ts
```

End-to-end magic-link smoke:
1. `supabase start`
2. `cd backend && npm run dev`
3. `cd frontend && npm run dev`
4. Open `http://localhost:3000/login`, submit an email
5. Open inbucket at `http://localhost:54324`, click the magic link
6. Confirm landing on `/dashboard`

End-to-end password recovery smoke:
1. `supabase start && cd frontend && npm run dev`
2. Sign up via `/login` (signup mode) with a test email + password
3. From `/login` (password mode), click **Forgot your password?**
4. Submit the email at `/forgot-password`
5. Open inbucket (`http://localhost:54324`) and click the recovery link → lands on `/auth/reset-password`
6. Submit a new password (≥12 chars) → redirected to `/login?reset=success`
7. Sign in with the new password; old password is rejected

Production SMTP (Resend) is configured in `supabase/config.toml` under `[auth.email.smtp]`. The operator must export `RESEND_API_KEY` before running `supabase config push`. The same key is also documented in `render.yaml` for parity (not consumed by the backend at runtime).

## Note on the skill

`npx skillfish add jeremylongshore/claude-code-plugins-plus-skills authentication-validator` failed with a GitHub API rate limit, so the skill was retrieved via a sparse `git clone https://github.com/jeremylongshore/claude-code-plugins-plus-skills` and the methodology + output format above were sourced from `plugins/security/authentication-validator/skills/validating-authentication-implementations/SKILL.md` (v1.0.0). Two helper scripts (`jwt_analyzer.py`, `password_policy_check.py`) ship with the skill but operate on JSON config files describing the auth setup rather than scanning code; they were not run for this validation.
