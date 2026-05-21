# RentGuard UI Testing Checklist

This checklist is the launch gate for UI readiness. A release is not ready
until the automated checks pass and the manual device signoff is complete.

## Automated PR Gate

Run on every frontend PR through `.github/workflows/frontend-ui-ci.yml`:

- `npm test`
- `npm run build`
- `npm run e2e:smoke`

The smoke suite starts a deterministic mock backend and validates:

- Homepage, lookup, marketing, legal, robots, and sitemap routes.
- Address lookup success through NDJSON streaming and report redirect.
- Building report tab navigation, source links, share modal, and anonymous save gate.
- Dashboard anonymous redirect to login.
- Critical console/page errors, blank pages, clipped controls, and horizontal overflow.
- Chromium desktop and WebKit desktop.

The Playwright config runs with one worker by default so local and CI runs
stay deterministic. Override with `E2E_WORKERS=<n>` only when stress
testing the harness intentionally.

## Nightly Full Matrix

The nightly workflow runs `npm run e2e:full` across:

- Chromium desktop.
- Firefox desktop.
- WebKit desktop.
- Edge-equivalent Chromium user agent.
- Mobile Safari-sized WebKit.
- Mobile Chrome-sized Chromium.
- iPad-sized WebKit.

The suite covers:

- Public pages and legal/monetization disclosure pages.
- Lookup success, autocomplete, blocked-listing fallback, ambiguous addresses, outside-NYC waitlist, quota/cost/error states, malformed streams, and incomplete streams.
- Building reports with normal data, empty/missing data, and large row counts.
- Login, invalid callback/confirm links, forgot-password, reset-password, dashboard auth gate, and affiliate disclosure modal.
- Breakpoints: 320, 375, 390, 430, 768, 1024, 1280, 1440, and 1920 px.
- Portrait and landscape mobile/tablet orientations.
- Keyboard-only focus paths, modal Escape behavior, reduced-motion loading, and critical Axe accessibility checks.

## Staging Smoke

Set the repository variable `STAGING_FRONTEND_URL`, then run the
`frontend-ui-ci` workflow manually. The staging job runs:

```sh
E2E_BASE_URL="$STAGING_FRONTEND_URL" npm run e2e:staging
```

This verifies deployed public pages, auth gate behavior, `robots.txt`, and
`sitemap.xml` without the local mock backend.

## Manual Real-Browser Signoff

Playwright WebKit is required but does not replace real Safari/iOS checks.
Before public launch, sign off the following manually:

- Latest Safari on macOS.
- Latest Chrome, Firefox, and Edge on desktop.
- iOS Safari on a real iPhone or BrowserStack/Sauce/LambdaTest.
- Android Chrome on a real Android device or BrowserStack/Sauce/LambdaTest.

For each browser/device, verify:

- Homepage renders without horizontal scrolling or clipped text.
- Lookup form accepts address input and shows loading state.
- Building report tabs are readable and tappable.
- Save-building opens the sign-in modal when anonymous.
- Login and forgot-password pages fit the viewport.
- Affiliate disclosure modal appears before partner navigation.
- Legal footer/disclaimer copy is visible on report pages.

## Release Blockers

Do not ship if any of these are true:

- Any supported browser fails a critical lookup, report, auth, dashboard, or disclosure path.
- Any E2E run reports `console.error` or uncaught page errors.
- Any mobile/tablet viewport has incoherent overlap, clipped controls, or horizontal page scroll.
- Any legal/disclaimer snapshot or disclosure copy drifts from the canonical docs.
- Staging smoke fails against the deployed Vercel/Render/Supabase environment.
