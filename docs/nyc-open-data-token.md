# NYC Open Data app token — registration checklist (Phase 0.3)

The data verifier in `backend/scripts/verify-data-sources.ts` works without an
app token at the unauthenticated tier (~1k requests/hour shared across all
unauthenticated callers from your IP). The token raises that to ~10k/hour per
token. We need it before the Phase 2 ingestion job ships, but you can defer
this if you're just running 0.3's acceptance check.

## Step-by-step (5 minutes)

1. **Sign up.** Go to https://data.cityofnewyork.us/signup. Use your project
   email address. The portal will email you a confirmation link —
   click it.
2. **Pick a strong password.** A randomly-generated suggestion is in
   `docs/credentials-to-set.md` (in the next section of this doc). NYC Open
   Data does not require 2FA but you can opt in via the profile menu.
3. **Open Developer Settings.** Once logged in, click your avatar in the top
   right → Profile → Edit Profile → "Developer Settings" tab. Direct URL once
   logged in: https://data.cityofnewyork.us/profile/edit/developer_settings.
4. **Create an app token.** Click "Create New App Token". Fill in:
   - Application Name: `RentGuard backend (staging)`
   - Description: `Server-side ingestion of HPD/DOB/311/Marshal/Bedbug/Lead datasets for the RentGuard renter-protection service.`
   - Website URL: `https://www.rentguard.cc`
   - Public token: leave the "Public" toggle ON. The public/anonymous token is
     the one we send in the `X-App-Token` header. There is also a private
     "App Token Secret" — we don't currently need it.
5. **Save** and copy the App Token value. It looks like 25 alphanumeric
   characters with no separator. Treat it as a secret even though it's the
   "public" token — anyone with it can use your rate-limit quota.
6. **Stash it.** Two places:
   - Local `.env`: open `backend/.env` (or copy from `backend/.env.example`)
     and set `NYC_OPEN_DATA_APP_TOKEN=<your-token>`.
   - Render dashboard (when staging is deployed): the same key under the
     backend service's Environment tab.

## Verification

From the project root, run:

```bash
cd backend
npm run verify:data-sources
```

Expected output:

```
RentGuard data-source verifier — 8 endpoints, with NYC_OPEN_DATA_APP_TOKEN

[PASS] wvxf-dwi5  HTTP 200  120ms  HPD Housing Maintenance Code Violations
        primary key 'violationid' present (row had 35 fields)
[PASS] tesw-yqqr  HTTP 200  90ms   HPD Multiple Dwelling Registrations
        primary key 'registrationid' present (row had …)
… (six more) …

Result: 8/8 passed, 0 failed
```

If a row reports `FAIL`, check:

- HTTP 403 / 429: rate-limited — wait or confirm the token is being read.
- HTTP 200 but missing primary key: the dataset's schema may have shifted
  upstream. Update `docs/data-sources.md` and the corresponding `primaryKey`
  in `scripts/verify-data-sources.ts`.
- Network timeout from the dev sandbox: this is expected — run on your
  Mac (or any non-restricted network).

## Acceptance criteria (Phase 0.3 from the roadmap)

> `curl https://data.cityofnewyork.us/resource/... -H "X-App-Token: ..."`
> succeeds for each documented endpoint; `docs/data-sources.md` lists every
> endpoint, its primary key, and its refresh cadence.

This file's verification step satisfies the curl criterion — the script runs
the equivalent fetch against all 8 endpoints. The doc requirement is met by
`docs/data-sources.md`.
