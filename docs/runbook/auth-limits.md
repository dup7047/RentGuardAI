# Supabase Auth Limits

Phase 2.1 uses Supabase Auth email magic links through `signInWithOtp`.
Do not add an application-level rate limiter in v1; tune Supabase Auth limits
from the Supabase dashboard if abuse appears.

## Current Values

Supabase documents these hosted Auth defaults:

- Built-in email provider sends: 2 emails per hour. This can only be changed
  after custom SMTP is configured.
- OTP sends from `/auth/v1/otp`: 30 OTPs per hour.
- Repeat OTP or magic-link sends to the same user: 60 seconds between sends.
- Verification requests: 360 per hour by IP, with bursts up to 30 requests.
- Token refresh requests: 1800 per hour by IP, with bursts up to 30 requests.

Reference: <https://supabase.com/docs/guides/auth/rate-limits>

## Local Development

The committed local Supabase config keeps `email_sent = 2`,
`sign_in_sign_ups = 30`, `token_verifications = 30`, and
`token_refresh = 150`. Local email previews are available through Inbucket on
port 54324 when the Supabase CLI stack is running.

These local values map to the hosted defaults above: `token_verifications = 30`
per 5 minutes equals 360 per hour, and `token_refresh = 150` per 5 minutes
equals 1800 per hour.

## Staging Auth Checklist

- Email provider: Resend SMTP configured in Supabase Auth SMTP settings.
- Rate-limit screen matches the Current Values section, or any intentional
  override is recorded here with the date and operator.
- Templates: magic-link and signup-confirmation emails are branded as
  RentGuard NYC and point to `/auth/confirm` with `token_hash` and `type`.
- Redirect allow-list includes the staging frontend URL and
  `<staging-url>/auth/callback` plus `<staging-url>/auth/confirm`.
- Manual test: `/login` accepts an email, the email arrives through Resend,
  the magic link lands on `/dashboard`, and `Log out` clears the session.
