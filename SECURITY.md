# Security Policy

## Reporting a vulnerability

Email security reports to **security@rentguard.cc**. Please do not file public GitHub issues for suspected vulnerabilities — that exposes the issue to other readers before a fix is available.

We aim to acknowledge reports within three business days and to close confirmed issues within 90 days. If a report is sensitive enough to warrant coordinated disclosure, we'll work with you on a timeline.

In your report, please include:

- A description of the issue and its impact
- Steps to reproduce (or a proof-of-concept)
- The affected version / commit SHA / URL

## Security model summary

RentGuard is **passwordless**. There are no passwords stored or accepted by the application. Authentication happens via Supabase magic-link OTP:

- The browser requests a sign-in via `supabase.auth.signInWithOtp` (PKCE flow).
- Supabase emails a single-use, 1-hour OTP link.
- The link lands on `/auth/confirm` (`verifyOtp`) or `/auth/callback` (`exchangeCodeForSession`), which both validate the redirect target against an in-app allowlist of `['/dashboard']`.
- On success, Supabase issues an HS256 JWT (1-hour `exp`), stored in an `httpOnly`, `Secure` (in production), `SameSite=Lax` cookie via `@supabase/ssr`.

The Hono backend (`backend/src/middleware/auth.ts`) verifies every Bearer token with:

- `algorithms: ['HS256']` (pinned; rejects `alg: none`)
- `audience: 'authenticated'`
- `issuer: ${SUPABASE_URL}/auth/v1`
- `exp` enforced by `jose.jwtVerify` default

Database access is gated by Row-Level Security on every user-scoped table; policies key off `auth.uid()`. Backend writes that need to bypass RLS use the Supabase service-role connection (`DATABASE_URL`). See `backend/drizzle/0002_phase_1_3_security.sql` and friends.

The full audit (CWE mapping + OWASP ASVS V2/V3 matrix) lives at [`docs/auth-validation.md`](docs/auth-validation.md).

## Known accepted risks

These were identified in `docs/auth-validation.md` and accepted for the current product phase. They are deliberate trade-offs, not unfixed bugs.

### Magic-link OTP carried in URL query string (F5 — CWE-532, Low)

The OTP `token_hash` rides in the URL query string of `/auth/confirm?token_hash=…&type=…`. This is the standard Supabase OOB flow. Mitigations:

- Single-use — the token is consumed by `verifyOtp` on first hit.
- 1-hour TTL — expires regardless.
- Server-side verification before any redirect, so the user's browser never holds the verified token in `Referer` for outbound clicks.

We accept this trade-off because the alternative (a separate confirmation step that asks the user to retype a code) hurts the magic-link UX without meaningfully reducing risk on a 1-hour single-use OTP.

### MFA disabled (F3 — CWE-308, Medium)

TOTP, phone, and WebAuthn MFA are all disabled in `supabase/config.toml`. Acceptable for a free-tier rental tool; **must be revisited** before either of the following ships:

- **Stripe billing** (Phase 4.6 — lease-review checkout, Search Pass subscription). MFA on accounts with payment methods on file.
- **B2B firm portal** (Phase 7+). MFA enforced for firm-admin role.

Pre-conditions for enabling:

```toml
[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
```

Plus a frontend MFA enrollment screen (currently absent — that's why this is gated, not just a config flip).

## References

- [`docs/auth-validation.md`](docs/auth-validation.md) — full audit applying the `authentication-validator` skill, including the ASVS compliance matrix and remediation history.
- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [NIST SP 800-63B: Digital Identity Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
