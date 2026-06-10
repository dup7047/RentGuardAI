# Phase 3 Implementation Plan: Free Building Lookup

> **Audience:** an implementing Claude session that will execute this plan end-to-end. Every design choice is locked. Every file path is exact. Every type is fully specified. Every test case has input + expected output. No "decide later" — if it says "decide", it's a bug in the plan.

---

## Context

Phase 3 ships the free building-lookup feature: a user pastes an NYC address (or listing URL); the system returns an AI-generated risk summary backed by HPD violations, DOB complaints, owner records, FARE Act check, and a Worst Landlord Watchlist match. This is the first phase that combines data ingestion, AI generation, billing-aware rate limits, and SEO surface area, so it sets patterns reused in Phases 4 (lease review) and 6 (FARE Act tool).

**11 sub-phases in execution order:** 3.1 → 3.2 → 3.3 → 3.4 → 3.5 → 3.6 → 3.7 → 3.7b → 3.8 → 3.9 → 3.10. Phases 3.7b is a launch-blocker — public traffic without it is uncapped cost risk.

**Foundations already in place:**
- Phase 1.1–1.7 (backend scaffold, schema, RLS, storage, restore drill).
- Phase 2.1 (Supabase magic-link auth on frontend).
- Phase 0.3 (NYC Open Data verifier + `docs/data-sources.md`).
- Phase 0.4 (Stripe products + webhook).

**What Phase 3 does NOT do:**
- Lease review (Phase 4).
- FARE Act interactive tool (Phase 6).
- B2B portal (Phase 7).
- Worst Landlord cron — manual import only (cron is Phase 8.7).
- Batch API for SEO summary regen (Phase 3.10b, deferred).

---

## Decisions (locked)

Every choice the implementing Claude needs to make has been pre-decided here. If it's not in this section, it isn't open for re-debate.

| Decision | Value | Rationale |
|---|---|---|
| Anon-token cookie name | `rentguard-anon` | Matches `rentguard-auth` convention from Phase 2.1 |
| Anon-token cookie TTL | 12 months (31536000 s) | Matches Privacy Policy §6.1 retention |
| Anon-token cookie attributes | `HttpOnly; Secure; SameSite=Lax; Path=/` | Defense-in-depth; `Secure` only set when `NODE_ENV === 'production'` |
| `NEXT_PUBLIC_BACKEND_URL` (local) | `http://localhost:8080` | Matches existing backend port in `render.yaml` |
| `NEXT_PUBLIC_BACKEND_URL` (prod) | `https://rentguard-backend.onrender.com` | Matches `STRIPE_WEBHOOK_URL` default |
| OpenAI API surface | **Chat Completions API** (`/v1/chat/completions`) | gpt-4o-mini supports it; simpler than Responses API |
| OpenAI model | `gpt-4o-mini` | Per roadmap; pricing $0.15/M input, $0.60/M output |
| Token estimator | Char-based (`Math.ceil(chars / 4)`) | Dependency-free; ~5% under-estimate is fine for budget clamps |
| Body validation | **Zod** | Already in TS-first ecosystem; cleaner than hand-rolled |
| HTTP CORS plugin | `hono/cors` (built-in) | No new dep |
| JWT verification (backend) | **`jose`** library + Supabase JWT secret | Standard, well-tested |
| Result page architecture | **Single canonical URL: `/building/[bbl]`** | Eliminates `/lookup/[id]` RLS complexity; SEO-friendly |
| Post-lookup flow | Backend returns BBL → frontend `router.push('/building/[bbl]?fresh=1')` | `?fresh=1` query param tells page to bypass ISR cache once |
| `/v1/building/:bbl` endpoint | Backend service-role connection bypasses RLS | Returns publicly-cached data; no auth required |
| Frontend ↔ backend auth | Browser fetches Supabase session, attaches `Authorization: Bearer ${access_token}` if present | Anon flow continues if no token |
| Beehiiv enrollment | **Backend** `POST /v1/waitlist/email` endpoint that POSTs to Beehiiv `/v2/publications/{pub_id}/subscriptions` | No Supabase Edge Function needed |
| Beehiiv API credentials | New env vars: `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID` | Stub-able for local dev (logs intent if missing) |
| OG image pattern | Next.js 15 `opengraph-image.tsx` per route | Built-in; no separate API route |
| Sitemap regeneration | `app/sitemap.ts` with `export const revalidate = 3600` (1h ISR) | Natural; no explicit trigger needed |
| Watchlist source URL | `https://landlordwatchlist.com/data/2025-watchlist.csv` (env-overrideable) | Stable URL; document fallback in `data-sources.md` |
| Frontend test runner | **Vitest** (already used in backend) + `@testing-library/react` + `happy-dom` | Same runner across stack |
| E2E test runner | **Playwright** | Industry standard; integrates well with Next.js |
| CORS allowed origins | `http://localhost:3000`, `http://localhost:3100`, `https://rentguard.cc`, `https://www.rentguard.cc`, `https://*.vercel.app` | Mirrors `supabase/config.toml` redirect URLs |
| Migration numbers | 0008 (landlord link), 0009 (cost_alerts) | Current journal has 0000–0007 |
| Disclaimer file format | **Markdown with `## §N` heading anchors**, parsed at build time into typed object | Single source of truth; legal can edit Markdown directly |

---

## Pre-flight checklist (do first; ~15 min)

Each item below is **executable** — run it, get green, move on. No design questions.

```sh
# 1. Pull latest
cd <repo-root>
git pull origin main
git status  # clean

# 2. Backend env: add OPENAI_API_KEY + BEEHIIV_API_KEY + BEEHIIV_PUBLICATION_ID to .env.example
#    (handled in Phase 3.7 step 0 + Phase 3.9 step 0)

# 3. Frontend env: add NEXT_PUBLIC_BACKEND_URL to frontend/.env.example
#    (handled in Phase 3.8 step 0)

# 4. Local Supabase up + schema current
supabase start
cd backend
npm install
npm run migrate
npm run verify:restore   # 44/44

# 5. Phase 0.3 verifier still passes
npm run verify:data-sources   # exit 0; if not, document and continue (don't block)

# 6. Phase 2.1 smoke test (manual, one minute)
cd ../frontend
nvm use 20  # required for Next.js 15
npm install
npm run dev &
# In browser: http://localhost:3000/login → submit email → check Inbucket http://127.0.0.1:54324
# → click magic link → land on /dashboard → click Log out → land on /login?loggedOut=1
# Stop dev server.

# 7. Create Phase 0.1 stub disclaimer file (REQUIRED by 3.9)
#    Use the exact text in Appendix A of this plan
mkdir -p ../docs/legal
# (file creation happens in Phase 3.9 step 1; pre-creating it here is fine but not required)
```

If all green, proceed to 3.1.

---

## Phase 3.1 — NYC Open Data client library

**Goal:** typed clients for the 8 NYC Open Data Socrata datasets, with a 24-hour cache layer keyed on `buildings.raw_data` JSONB.

### Files to create

```
backend/src/data/
  endpoints.ts                 # consolidated dataset registry (lift from scripts/verify-data-sources.ts)
  nyc-client.ts                # low-level Socrata fetcher
  cache.ts                     # buildings.raw_data read/write
  types.ts                     # shared types: Borough, Violation, Owner, etc.
  datasets/
    hpd-violations.ts
    hpd-registrations.ts
    hpd-contacts.ts
    dob-complaints.ts
    three11-housing.ts
    evictions.ts
    bedbug.ts
    lead-paint.ts
backend/test/data/
  nyc-client.test.ts
  cache.integration.test.ts
  datasets/
    hpd-violations.test.ts
    hpd-registrations.test.ts
    hpd-contacts.test.ts
    dob-complaints.test.ts
    three11-housing.test.ts
    evictions.test.ts
    bedbug.test.ts
    lead-paint.test.ts
  integration.test.ts          # live Socrata smoke test (.skip in CI)
backend/scripts/
  verify-data-sources.ts       # MODIFY: import ENDPOINTS from src/data/endpoints.ts
```

### npm packages

None new. Uses existing `node:fetch` (built into Node 20+) and `pg`.

### Implementation steps

**Step 0 — types.ts:**
```ts
// backend/src/data/types.ts
export type Borough = 'MANHATTAN' | 'BRONX' | 'BROOKLYN' | 'QUEENS' | 'STATEN ISLAND';
export type DatasetKey =
  | 'hpd_violations'
  | 'hpd_registrations'
  | 'hpd_contacts'
  | 'dob_complaints'
  | 'three11_housing'
  | 'evictions'
  | 'bedbug'
  | 'lead_paint';
export type CachedData = Partial<Record<DatasetKey, unknown[]>> & {
  _meta?: Partial<Record<`${DatasetKey}_fetched_at`, string>>;
};
```

**Step 1 — endpoints.ts:** Lift `ENDPOINTS` array from `scripts/verify-data-sources.ts` verbatim. Update the verifier script to `import { ENDPOINTS } from '../src/data/endpoints.js';`. Confirm `npm run verify:data-sources` still exits 0.

**Step 2 — nyc-client.ts:**
```ts
// backend/src/data/nyc-client.ts
import { logger } from '../logger.js';

export class SocrataError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'SocrataError';
  }
}

export async function socrataQuery<T>(
  resourceId: string,
  params: Record<string, string>,
): Promise<T[]> {
  const url = new URL(`https://data.cityofnewyork.us/resource/${resourceId}.json`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (process.env.NYC_OPEN_DATA_APP_TOKEN) {
    headers['X-App-Token'] = process.env.NYC_OPEN_DATA_APP_TOKEN;
  }
  const start = Date.now();
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(timer);
      const ms = Date.now() - start;
      if (res.status === 429 && attempt === 1) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!res.ok) throw new SocrataError(`Socrata ${resourceId} → ${res.status}`, res.status);
      const data = (await res.json()) as T[];
      logger.info({ resourceId, status: res.status, durationMs: ms, recordCount: data.length });
      return data;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 2) throw e instanceof SocrataError ? e : new SocrataError(String(e));
    }
  }
  throw new SocrataError('unreachable');
}
```

**Step 3 — cache.ts:**
```ts
// backend/src/data/cache.ts
import { getDb } from '../db/client.js';
import { buildings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { CachedData, DatasetKey } from './types.js';

const TTL_MS = 24 * 60 * 60 * 1000;

export async function getCached(bbl: string, key: DatasetKey): Promise<unknown[] | null> {
  const [row] = await getDb().select().from(buildings).where(eq(buildings.bbl, bbl)).limit(1);
  if (!row) return null;
  const data = (row.rawData ?? {}) as CachedData;
  const fetchedAtKey = `${key}_fetched_at` as const;
  const fetchedAt = data._meta?.[fetchedAtKey];
  if (!fetchedAt) return null;
  if (Date.now() - new Date(fetchedAt).getTime() > TTL_MS) return null;
  return (data[key] as unknown[]) ?? null;
}

export async function setCached(
  bbl: string,
  key: DatasetKey,
  rows: unknown[],
  meta: { address?: string; borough?: string } = {},
): Promise<void> {
  const fetchedAtKey = `${key}_fetched_at` as const;
  const db = getDb();
  // Upsert pattern: insert if missing, then merge JSONB
  await db
    .insert(buildings)
    .values({
      bbl,
      address: meta.address ?? '',
      borough: meta.borough ?? '',
      lastFetchedAt: new Date(),
      rawData: { [key]: rows, _meta: { [fetchedAtKey]: new Date().toISOString() } },
    })
    .onConflictDoUpdate({
      target: buildings.bbl,
      set: {
        rawData: sql`
          jsonb_set(
            jsonb_set(coalesce(${buildings.rawData}, '{}'::jsonb), ${`{${key}}`}, ${JSON.stringify(rows)}::jsonb),
            ${`{_meta,${fetchedAtKey}}`},
            to_jsonb(now()::text)
          )
        `,
        lastFetchedAt: new Date(),
      },
    });
}
```
*(Note: the `sql` import + JSONB merge is the trickiest part. If Drizzle JSONB merge proves hairy, fall back to `SELECT … FOR UPDATE; UPDATE` in a transaction.)*

**Step 4 — each dataset wrapper** has the same shape:
```ts
// backend/src/data/datasets/hpd-violations.ts
import { socrataQuery } from '../nyc-client.js';
import { getCached, setCached } from '../cache.js';
import { ENDPOINTS } from '../endpoints.js';

export type HpdViolation = {
  violationid: string;
  bbl: string;
  novissueddate: string;
  currentstatus: string;
  novdescription: string;
  // …add fields actually used
};

export async function getHpdViolations(bbl: string): Promise<HpdViolation[]> {
  const cached = await getCached(bbl, 'hpd_violations');
  if (cached) return cached as HpdViolation[];
  const ep = ENDPOINTS.find((e) => e.key === 'hpd_violations')!;
  const rows = await socrataQuery<HpdViolation>(ep.resourceId, { $where: `bbl='${bbl}'`, $limit: '1000' });
  await setCached(bbl, 'hpd_violations', rows);
  return rows;
}
```
Repeat for the other 7 datasets (hpd-registrations, hpd-contacts, dob-complaints, three11-housing, evictions, bedbug, lead-paint). Field selections per dataset are documented in `docs/data-sources.md`.

### Tests

```sh
cd backend
npm test -- test/data
npm run verify:data-sources
```

**Required tests (28 total):**

For each of the 8 dataset wrappers, three tests:
1. **Happy path:** mock fetch with a valid Socrata response → returns parsed array.
2. **Empty result:** mock fetch with `[]` → returns `[]`, no throw.
3. **Cache hit:** seed `buildings.raw_data` with fresh data → wrapper returns cached without calling fetch.

Plus 4 client-level tests:
- `socrataQuery` retries once on 429.
- `socrataQuery` throws after second 429.
- `socrataQuery` includes `X-App-Token` when env var set.
- `socrataQuery` fires `AbortController` after 10s.

### Acceptance / definition of done

- [ ] All 28 tests pass.
- [ ] `npm run verify:data-sources` exit 0.
- [ ] Live integration smoke (run manually): `getHpdViolations('1008440007')` returns >0 rows.
- [ ] `git diff backend/scripts/verify-data-sources.ts` shows it now imports `ENDPOINTS` from `src/data/endpoints.js`.

### Commit
```
feat: Phase 3.1 — NYC Open Data typed client + 24h cache
```

---

## Phase 3.2 — Address geocoding to BBL

**Goal:** turn user-pasted address into a BBL or non-NYC signal. Pure (no DB writes).

### Files to create

```
backend/src/geo/
  geosearch.ts
  normalize.ts
  types.ts
backend/test/geo/
  geosearch.test.ts
  normalize.test.ts
  geosearch.integration.test.ts  # live; .skip in CI
```

### Implementation steps

**Step 1 — types.ts:**
```ts
// backend/src/geo/types.ts
import type { Borough } from '../data/types.js';

export type GeocodeResult =
  | { kind: 'matched'; bbl: string; address: string; borough: Borough; confidence: number }
  | { kind: 'ambiguous'; matches: Array<{ bbl: string; address: string; borough: Borough }> }
  | {
      kind: 'outside_nyc';
      detected_city: string | null;
      detected_state: string | null;
      raw_input: string;
    };

export class GeocodeError extends Error {
  constructor(public readonly code: 'empty_input' | 'unavailable', message: string) {
    super(message);
    this.name = 'GeocodeError';
  }
}
```

**Step 2 — normalize.ts:**
```ts
const ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bAVE\b/g, 'AVENUE'],
  [/\bST\b/g, 'STREET'],
  [/\bBLVD\b/g, 'BOULEVARD'],
  [/\bRD\b/g, 'ROAD'],
  [/\bDR\b/g, 'DRIVE'],
  [/\bPL\b/g, 'PLACE'],
  [/\bPKWY\b/g, 'PARKWAY'],
  [/\bSQ\b/g, 'SQUARE'],
  [/\bN\b/g, 'NORTH'],
  [/\bS\b/g, 'SOUTH'],
  [/\bE\b/g, 'EAST'],
  [/\bW\b/g, 'WEST'],
];
export function normalize(input: string): string {
  let s = input.trim().toUpperCase().replace(/[,]/g, '').replace(/\s+/g, ' ');
  for (const [pat, repl] of ABBREVIATIONS) s = s.replace(pat, repl);
  return s;
}
```

**Step 3 — geosearch.ts:**
```ts
import { normalize } from './normalize.js';
import { GeocodeError, type GeocodeResult } from './types.js';
import type { Borough } from '../data/types.js';
import { logger } from '../logger.js';

const STATE_REGEX = /\b(?:WA|OR|CA|ID|NV|MT|UT|AZ|CO|WY|NM|TX|OK|KS|NE|SD|ND|MN|IA|MO|AR|LA|MS|AL|TN|KY|WV|VA|NC|SC|GA|FL|MD|DE|NJ|PA|OH|IN|IL|MI|WI|ME|NH|VT|MA|CT|RI|DC|HI|AK)\b/;
const NYC_BOROUGHS: Borough[] = ['MANHATTAN', 'BRONX', 'BROOKLYN', 'QUEENS', 'STATEN ISLAND'];

function tryDetectOutsideNyc(raw: string): { city: string | null; state: string | null } {
  const stateMatch = raw.toUpperCase().match(STATE_REGEX);
  if (!stateMatch) return { city: null, state: null };
  const state = stateMatch[0];
  // City = the word(s) before the state
  const before = raw.toUpperCase().slice(0, stateMatch.index ?? 0).trim();
  const cityMatch = before.match(/(\b[A-Z][A-Z]+(?:\s+[A-Z][A-Z]+)?)\s*$/);
  return { city: cityMatch?.[1] ?? null, state };
}

export async function geosearch(input: string): Promise<GeocodeResult> {
  const trimmed = input.trim();
  if (!trimmed) throw new GeocodeError('empty_input', 'empty input');

  const normalized = normalize(trimmed);
  const url = `https://geosearch.planninglabs.nyc/v2/search?text=${encodeURIComponent(normalized)}&size=5&layers=address`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new GeocodeError('unavailable', 'geosearch unavailable');
  }
  if (!res.ok) throw new GeocodeError('unavailable', `geosearch ${res.status}`);
  const json = (await res.json()) as { features: Array<{ properties: { confidence?: number; addendum?: { pad?: { bbl?: string } }; label?: string; borough?: string } }> };
  const feats = json.features ?? [];

  if (feats.length === 0) {
    const det = tryDetectOutsideNyc(trimmed);
    return { kind: 'outside_nyc', detected_city: det.city, detected_state: det.state, raw_input: trimmed };
  }

  const top = feats[0];
  const bbl = top.properties.addendum?.pad?.bbl;
  const conf = top.properties.confidence ?? 0;
  const borough = (top.properties.borough?.toUpperCase() ?? 'MANHATTAN') as Borough;

  if (bbl && conf >= 0.9) {
    return { kind: 'matched', bbl, address: top.properties.label ?? trimmed, borough, confidence: conf };
  }

  // Ambiguous: multiple distinct BBLs with similar confidence
  const distinctBbls = new Set(feats.map((f) => f.properties.addendum?.pad?.bbl).filter(Boolean));
  if (distinctBbls.size > 1) {
    return {
      kind: 'ambiguous',
      matches: feats
        .filter((f) => f.properties.addendum?.pad?.bbl)
        .map((f) => ({
          bbl: f.properties.addendum!.pad!.bbl!,
          address: f.properties.label ?? '',
          borough: (f.properties.borough?.toUpperCase() ?? 'MANHATTAN') as Borough,
        })),
    };
  }

  // Single low-confidence match: still return it
  if (bbl) {
    return { kind: 'matched', bbl, address: top.properties.label ?? trimmed, borough, confidence: conf };
  }

  // No BBL at all → outside_nyc
  const det = tryDetectOutsideNyc(trimmed);
  return { kind: 'outside_nyc', detected_city: det.city, detected_state: det.state, raw_input: trimmed };
}
```

### Tests

**Required (10):**
1. `normalize("350 5th ave, new york, ny")` → `"350 5TH AVENUE NEW YORK NY"`.
2. `normalize("123 W 5th St")` → `"123 WEST 5TH STREET"`.
3. Mock 1 feature with conf=0.95, BBL "1008440007" → `kind: 'matched'`.
4. Mock 0 features, input "350 5th Ave NYC" → `kind: 'outside_nyc'`, city detected null, state null.
5. Mock 0 features, input "1600 Pennsylvania Ave Washington DC" → `kind: 'outside_nyc'`, `detected_city: "WASHINGTON"`, `detected_state: "DC"`.
6. Mock 3 features with distinct BBLs → `kind: 'ambiguous'`, matches.length === 3.
7. Mock 500 → throws `GeocodeError('unavailable')`.
8. `geosearch("")` → throws `GeocodeError('empty_input')`.
9. Mock 1 feature with conf=0.7 → still `kind: 'matched'` (single result, low conf).
10. Mock fetch timeout → throws `GeocodeError('unavailable')`.

### Acceptance / definition of done

- [ ] 10 unit tests pass.
- [ ] 1 live integration test (`.skip` in CI): `geosearch("350 5th Ave New York NY")` returns `kind: 'matched'`, BBL `'1008440007'`.

### Commit
```
feat: Phase 3.2 — NYC GeoSearch wrapper with non-NYC fallback
```

---

## Phase 3.3 — Listing URL parser

**Goal:** extract address from StreetEasy/Zillow/Apartments.com URL slug. Pure (no fetch).

### Files to create

```
backend/src/parse/
  listing-url.ts
  listing-url.types.ts
backend/test/parse/
  listing-url.test.ts
```

### Implementation steps

**Step 1 — types:**
```ts
// backend/src/parse/listing-url.types.ts
export type ListingParseResult =
  | { kind: 'address_extracted'; address: string; host: 'streeteasy' | 'zillow' | 'apartments' }
  | { kind: 'requires_address'; reason: 'opaque_id' | 'unknown_host' };

export class ListingParseError extends Error {
  constructor(public readonly code: 'invalid_url') {
    super('invalid URL');
  }
}
```

**Step 2 — parser:**
```ts
// backend/src/parse/listing-url.ts
import { ListingParseError, type ListingParseResult } from './listing-url.types.js';

const SLUG_TO_ADDR = (slug: string) =>
  slug
    .replace(/_[a-z0-9]+$/i, '')        // drop _unitnum suffix
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function parseListingUrl(rawUrl: string): ListingParseResult {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ListingParseError('invalid_url');
  }

  const host = url.hostname.replace(/^www\./, '');
  const path = url.pathname;

  // StreetEasy: /building/<slug> or /rental/<id>/<slug>
  if (host === 'streeteasy.com') {
    let m = path.match(/^\/building\/([a-z0-9_-]+)\/?$/i);
    if (m) {
      const slug = m[1];
      if (/^\d/.test(slug)) return { kind: 'address_extracted', address: SLUG_TO_ADDR(slug), host: 'streeteasy' };
      return { kind: 'requires_address', reason: 'opaque_id' };
    }
    m = path.match(/^\/(?:rental|sale)\/\d+\/([a-z0-9_-]+)\/?$/i);
    if (m) return { kind: 'address_extracted', address: SLUG_TO_ADDR(m[1]), host: 'streeteasy' };
    return { kind: 'requires_address', reason: 'opaque_id' };
  }

  // Zillow: /homedetails/<slug>/<zpid>_zpid/
  if (host === 'zillow.com') {
    const m = path.match(/^\/homedetails\/([a-z0-9-]+)\/\d+_zpid\/?$/i);
    if (m) return { kind: 'address_extracted', address: SLUG_TO_ADDR(m[1]), host: 'zillow' };
    return { kind: 'requires_address', reason: 'opaque_id' };
  }

  // Apartments.com: /<slug>/<id>/
  if (host === 'apartments.com') {
    const m = path.match(/^\/([a-z0-9-]+-(?:ny|nj))\/\d+\/?$/i);
    if (m) return { kind: 'address_extracted', address: SLUG_TO_ADDR(m[1]), host: 'apartments' };
    return { kind: 'requires_address', reason: 'opaque_id' };
  }

  return { kind: 'requires_address', reason: 'unknown_host' };
}
```

### Tests (12)

| Input | Expected |
|---|---|
| `https://streeteasy.com/building/350-5th-avenue-new_york` | `address_extracted: "350 5th avenue new york"`, host=`streeteasy` |
| `https://streeteasy.com/rental/4112345/350-5th-avenue-new_york` | same |
| `https://streeteasy.com/building/some-opaque/12345` | `requires_address: 'opaque_id'` (path doesn't match `/building/<slug>/?` — it has extra segment) |
| `https://www.zillow.com/homedetails/350-5th-Ave-New-York-NY-10118/12345_zpid/` | `address_extracted: "350 5th Ave New York NY 10118"`, host=`zillow` |
| `https://www.zillow.com/b/12345_zid/` | `requires_address: 'opaque_id'` |
| `https://www.apartments.com/the-empire-state-building-new-york-ny/12345/` | `address_extracted: "the empire state building new york ny"`, host=`apartments` |
| `https://realtor.com/property/123` | `requires_address: 'unknown_host'` |
| `not a url` | throws `ListingParseError('invalid_url')` |
| `https://streeteasy.com/building/123-main-st_3a` | `address_extracted: "123 main st"` (drops `_3a` unit) |
| Source grep for `fetch(` in `listing-url.ts` | 0 matches |
| `https://streeteasy.com/agent/john-smith` | `requires_address: 'opaque_id'` |
| `https://www.streeteasy.com/building/350-5th-avenue-new_york/` (with www + trailing slash) | `address_extracted: …` |

### Definition of done
- [ ] 12 tests pass.
- [ ] `grep -r "fetch\|https.request\|node:http" backend/src/parse/` returns 0.

### Commit
```
feat: Phase 3.3 — listing URL slug parser (StreetEasy, Zillow, Apartments)
```

---

## Phase 3.4 — HPD Registered Owner lookup

**Goal:** given a BBL, return registered owner + head officer; cache in `landlords` table.

### Files to create / modify

```
backend/drizzle/0008_phase_3_4_landlord_link.sql       # NEW
backend/src/db/schema.ts                                # MODIFY: add registeredOwnerLandlordId
backend/src/data/landlord.ts                            # NEW
backend/test/data/landlord.integration.test.ts          # NEW
```

### Step 0 — migration

```sql
-- backend/drizzle/0008_phase_3_4_landlord_link.sql
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS registered_owner_landlord_id uuid
  REFERENCES public.landlords(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_buildings_landlord_id
  ON public.buildings (registered_owner_landlord_id);

CREATE INDEX IF NOT EXISTS idx_landlords_owner_name_lower
  ON public.landlords (lower(registered_owner_name));
```

Then update `backend/src/db/schema.ts`:
```ts
export const buildings = pgTable('buildings', {
  // … existing
  registeredOwnerLandlordId: uuid('registered_owner_landlord_id').references(() => landlords.id, { onDelete: 'set null' }),
});
```

Run `npm run db:generate` to confirm Drizzle picks up the change. If snapshot diff is clean (i.e. matches our hand-written migration), discard the auto-generated file. If different, reconcile.

### Step 1 — landlord.ts

```ts
// backend/src/data/landlord.ts
import { getDb } from '../db/client.js';
import { buildings, landlords } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { getHpdRegistrations } from './datasets/hpd-registrations.js';
import { getHpdContacts } from './datasets/hpd-contacts.js';

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

export type LandlordRecord = {
  registered_owner_name: string | null;
  hpd_corporation_name: string | null;
  registration_id: string | null;
  head_officer_name: string | null;
  head_officer_business_address: string | null;
  watchlist_rank: number | null;
  last_fetched_at: string;
};

export async function lookupLandlord(bbl: string): Promise<LandlordRecord> {
  const db = getDb();
  // 1. Cache lookup via buildings.registered_owner_landlord_id
  const [b] = await db.select().from(buildings).where(eq(buildings.bbl, bbl)).limit(1);
  if (b?.registeredOwnerLandlordId) {
    const [ll] = await db.select().from(landlords).where(eq(landlords.id, b.registeredOwnerLandlordId)).limit(1);
    if (ll && ll.lastFetchedAt && Date.now() - ll.lastFetchedAt.getTime() < STALE_AFTER_MS) {
      return {
        registered_owner_name: ll.registeredOwnerName,
        hpd_corporation_name: ll.hpdCorporationName,
        registration_id: null, // re-derived if needed
        head_officer_name: null,
        head_officer_business_address: null,
        watchlist_rank: ll.watchlistRank,
        last_fetched_at: ll.lastFetchedAt.toISOString(),
      };
    }
  }
  // 2. Live fetch
  const regs = await getHpdRegistrations(bbl);
  if (regs.length === 0) {
    return {
      registered_owner_name: null, hpd_corporation_name: null,
      registration_id: null, head_officer_name: null,
      head_officer_business_address: null, watchlist_rank: null,
      last_fetched_at: new Date().toISOString(),
    };
  }
  const reg = regs[0];
  const contacts = await getHpdContacts(reg.registrationid);
  const headOfficer = contacts.find((c) => c.type === 'HeadOfficer') ?? contacts[0] ?? null;

  // 3. Upsert landlords
  const [ll] = await db
    .insert(landlords)
    .values({
      registeredOwnerName: reg.corporationname ?? null,
      hpdCorporationName: reg.corporationname ?? null,
      lastFetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: sql`(lower(${landlords.registeredOwnerName}))`,
      set: { lastFetchedAt: new Date() },
    })
    .returning();

  // 4. Wire FK on buildings
  await db
    .update(buildings)
    .set({ registeredOwnerLandlordId: ll.id })
    .where(eq(buildings.bbl, bbl));

  return {
    registered_owner_name: ll.registeredOwnerName,
    hpd_corporation_name: ll.hpdCorporationName,
    registration_id: reg.registrationid,
    head_officer_name: headOfficer ? `${headOfficer.firstname ?? ''} ${headOfficer.lastname ?? ''}`.trim() : null,
    head_officer_business_address: headOfficer
      ? `${headOfficer.businesshousenumber ?? ''} ${headOfficer.businessstreetname ?? ''}, ${headOfficer.businesscity ?? ''}, ${headOfficer.businessstate ?? ''} ${headOfficer.businesszip ?? ''}`.trim()
      : null,
    watchlist_rank: ll.watchlistRank,
    last_fetched_at: ll.lastFetchedAt.toISOString(),
  };
}
```

*(Note: the upsert via `lower(name)` requires a unique partial index. Add to migration:* `CREATE UNIQUE INDEX IF NOT EXISTS uq_landlords_owner_name_lower ON public.landlords (lower(registered_owner_name)) WHERE registered_owner_name IS NOT NULL;`*)*

### Tests (5)

1. Mocked Socrata: known BBL → expected `LandlordRecord` with non-null name.
2. Cache hit: pre-seed `landlords` row + `buildings.registered_owner_landlord_id` with fresh `last_fetched_at` → no Socrata call (assert via mock spy count = 0).
3. Cache stale: `last_fetched_at = NOW() - 8 days` → re-fetch (mock spy count > 0).
4. No registration: mocked Socrata returns `[]` → all-null record returned, no throw.
5. FK integrity: insert `landlords`, link `buildings`, delete `landlords` → confirm `buildings.registered_owner_landlord_id` is NULL.

### Definition of done

- [ ] Migration `0008_phase_3_4_landlord_link.sql` applied locally; `verify:restore` still passes.
- [ ] 5 tests pass.
- [ ] Manual integration test: `lookupLandlord('1008440007')` returns Empire State Building's owner with non-null name.

### Commit
```
feat: Phase 3.4 — HPD registered owner lookup with 7-day cache
```

---

## Phase 3.5 — Worst Landlord Watchlist matcher

**Goal:** download Public Advocate's CSV; match against `landlords`; persist `watchlist_rank`.

### Files to create

```
backend/src/landlord/
  watchlist-match.ts
backend/scripts/
  import-watchlist.ts
backend/test/landlord/
  watchlist-match.test.ts
backend/test/landlord/
  import-watchlist.integration.test.ts
docs/data-sources.md     # MODIFY: add Worst Landlord Watchlist section
```

### Implementation steps

**Step 1 — normalize + match (pure):**
```ts
// backend/src/landlord/watchlist-match.ts
const STRIP_SUFFIX = /\b(LLC|L\.L\.C\.|INC\.?|CORP\.?|CORPORATION|LTD\.?|LP|LIMITED)\b/gi;
const STRIP_PUNCT = /[.,'&]/g;

export function normalizeOwner(name: string): string {
  return name
    .toUpperCase()
    .replace(STRIP_SUFFIX, '')
    .replace(STRIP_PUNCT, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export type WatchlistRow = { rank: number; ownerName: string };
export type LandlordRow = { id: string; registeredOwnerName: string | null };

export function matchByNormalized(
  watchlist: WatchlistRow[],
  landlords: LandlordRow[],
): Array<{ landlord_id: string; rank: number }> {
  const map = new Map<string, number>();
  for (const w of watchlist) map.set(normalizeOwner(w.ownerName), w.rank);
  const out: Array<{ landlord_id: string; rank: number }> = [];
  for (const l of landlords) {
    if (!l.registeredOwnerName) continue;
    const rank = map.get(normalizeOwner(l.registeredOwnerName));
    if (rank !== undefined) out.push({ landlord_id: l.id, rank });
  }
  return out;
}
```

**Step 2 — script:**
```ts
// backend/scripts/import-watchlist.ts
import 'dotenv/config';
import { getDb } from '../src/db/client.js';
import { landlords } from '../src/db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { matchByNormalized, type WatchlistRow } from '../src/landlord/watchlist-match.js';

const URL = process.env.WORST_LANDLORD_WATCHLIST_URL ?? 'https://landlordwatchlist.com/data/2025-watchlist.csv';
const dryRun = process.argv.includes('--dry-run');

async function main() {
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Watchlist fetch ${res.status}`);
  const csv = await res.text();
  const rows = parseCsv(csv); // simple: first row = header; "rank,owner_name"
  const watchlist: WatchlistRow[] = rows.map((r) => ({ rank: Number(r.rank), ownerName: r.owner_name }));

  const db = getDb();
  const all = await db.select({ id: landlords.id, registeredOwnerName: landlords.registeredOwnerName }).from(landlords);
  const matches = matchByNormalized(watchlist, all);

  console.log(`watchlist=${watchlist.length} landlords=${all.length} matched=${matches.length}`);
  if (dryRun) {
    console.log('[dry-run] would update:', matches.slice(0, 10));
    return;
  }
  let changed = 0;
  for (const m of matches) {
    const result = await db
      .update(landlords)
      .set({ watchlistRank: m.rank })
      .where(sql`${landlords.id} = ${m.landlord_id} AND coalesce(${landlords.watchlistRank}, -1) <> ${m.rank}`)
      .returning();
    if (result.length) changed++;
  }
  console.log(`updated=${changed} (others already at correct rank)`);
}

function parseCsv(csv: string): Array<Record<string, string>> {
  const [header, ...lines] = csv.split('\n').filter(Boolean);
  const cols = header.split(',').map((c) => c.trim());
  return lines.map((line) => {
    const vals = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    return Object.fromEntries(cols.map((c, i) => [c, vals[i] ?? '']));
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
```

**Step 3 — wire into `package.json`:**
```json
"import:watchlist": "tsx scripts/import-watchlist.ts",
"import:watchlist:dry-run": "tsx scripts/import-watchlist.ts --dry-run"
```

### Tests (8)

1. `normalizeOwner("Vantage Properties LLC")` === `normalizeOwner("VANTAGE PROPERTIES, LLC.")` → true.
2. `normalizeOwner("Croman, S. Realty Corp")` === `"CROMAN S REALTY"`.
3. `matchByNormalized` with 3 watchlist + 5 landlord → returns 2 expected matches.
4. `matchByNormalized` with empty watchlist → empty result.
5. Integration: seed 3 landlords, run `import:watchlist` against fixture CSV, assert ranks updated.
6. Integration: re-run script, assert `changed=0` (idempotent).
7. CSV parser: handles quoted values with commas inside.
8. CSV parser: trailing blank lines tolerated.

### Definition of done

- [ ] 8 tests pass.
- [ ] `npm run import:watchlist:dry-run` against the production URL prints a sensible match count without erroring (manual smoke).
- [ ] `docs/data-sources.md` updated with the Watchlist section: source URL, refresh cadence (annual + quarterly check), license/attribution, env var `WORST_LANDLORD_WATCHLIST_URL`.

### Commit
```
feat: Phase 3.5 — Worst Landlord Watchlist import + idempotent matcher
```

---

## Phase 3.6 — FARE Act compliance check

**Goal:** detect broker-fee indicators in listing text. Output is descriptive `flag` enum, never a legal verdict.

### Files to create

```
backend/src/fare/
  check.ts
  copy.ts
backend/test/fare/
  check.test.ts
```

### Implementation

```ts
// backend/src/fare/copy.ts
export const FARE_EXPLANATIONS = {
  no_indicators:
    'We did not find broker-fee language in this listing. The FARE Act prohibits charging tenants broker fees for non-tenant-hired brokers — only DCWP can determine if a specific listing violates the law.',
  possible_violation:
    "We found language suggesting the tenant may pay a broker fee, which DCWP can determine is a FARE Act violation. RentGuard does not make that determination — see the DCWP FARE Act page (https://www.nyc.gov/site/dca/about/FARE-Act.page) to file a complaint.",
  unclear:
    "We could not tell from the listing text whether a broker fee is charged. Ask the broker or landlord directly. RentGuard does not make legal determinations — only DCWP enforces the FARE Act.",
} as const;
```

```ts
// backend/src/fare/check.ts
import { FARE_EXPLANATIONS } from './copy.js';

export type FareFlag = 'no_indicators' | 'possible_violation' | 'unclear';

export type FareCheckResult = {
  flag: FareFlag;
  indicators: Array<{ phrase: string; offset: number; kind: 'strong' | 'counter' | 'ambiguous' }>;
  explanation: string;
};

const STRONG = [
  /tenant\s+pays?\s+broker['']?s?\s+fee/i,
  /broker(?:'s)?\s+fee\s+(?:paid|charged)\s+by\s+tenant/i,
  /applicant\s+covers\s+broker/i,
  /broker[\s,]{0,20}commission/i,
];
const COUNTER = [
  /no\s+broker(?:'s)?\s+fee/i,
  /broker(?:'s)?\s+fee\s+paid\s+by\s+(?:landlord|owner)/i,
  /no\s+fee/i,
];
const AMBIGUOUS = [/fees?\s+apply/i, /fees?\s+may\s+apply/i];

export function checkFare(input: { listingText?: string; listingUrl?: string }): FareCheckResult {
  const text = (input.listingText ?? '').trim();
  if (!text) {
    return { flag: 'unclear', indicators: [], explanation: 'no listing text provided' };
  }
  const indicators: FareCheckResult['indicators'] = [];
  for (const re of STRONG) {
    const m = text.match(re);
    if (m) indicators.push({ phrase: m[0], offset: m.index ?? 0, kind: 'strong' });
  }
  for (const re of COUNTER) {
    const m = text.match(re);
    if (m) indicators.push({ phrase: m[0], offset: m.index ?? 0, kind: 'counter' });
  }
  for (const re of AMBIGUOUS) {
    const m = text.match(re);
    if (m) indicators.push({ phrase: m[0], offset: m.index ?? 0, kind: 'ambiguous' });
  }
  const strong = indicators.filter((i) => i.kind === 'strong').length;
  const counter = indicators.filter((i) => i.kind === 'counter').length;
  const ambiguous = indicators.filter((i) => i.kind === 'ambiguous').length;

  let flag: FareFlag;
  if (strong > 0 && counter === 0) flag = 'possible_violation';
  else if (strong === 0 && counter > 0) flag = 'no_indicators';
  else flag = 'unclear';

  return { flag, indicators, explanation: FARE_EXPLANATIONS[flag] };
}
```

### Tests (10)

| Input | Expected `flag` |
|---|---|
| "Tenant pays broker fee equal to 15% annual rent." | `possible_violation` |
| "No broker fee. Direct with owner." | `no_indicators` |
| "Broker fee paid by landlord." | `no_indicators` |
| "Tenant pays broker fee, BUT landlord may cover it." (strong + counter) | `unclear` |
| "Standard listing. Fees may apply." | `unclear` |
| "" (empty) | `unclear`, explanation = `'no listing text provided'` |
| `{ listingUrl: 'https://...' }` only (no text) | `unclear` |
| "broker, commission negotiable" | `possible_violation` (matches `broker[\s,]commission`) |
| Unicode quotes: `"tenant pays broker's fee"` (curly) | `possible_violation` |
| Source grep for `fetch(` | 0 matches in `check.ts` |

### Definition of done

- [ ] 10 tests pass.
- [ ] `FARE_EXPLANATIONS` constants reviewed against `docs/legal/disclaimers.md` §3.2.

### Commit
```
feat: Phase 3.6 — FARE Act broker-fee indicator check (DCWP-deferring)
```

---

## Phase 3.7 — AI summary generation

**Goal:** generate ≤120-word risk summary using gpt-4o-mini Chat Completions; log every call to `ai_usage`.

### Files to create / modify

```
backend/.env.example                        # MODIFY: add OPENAI_API_KEY
backend/src/ai/
  openai-client.ts
  summary.ts
  prompts/
    lookup-summary.ts
backend/test/ai/
  openai-client.test.ts
  summary.test.ts
  manual-eval.fixtures.md                   # human-readable eval log
```

### Step 0 — env var

Append to `backend/.env.example`:
```
# --- Phase 3.7: OpenAI ---
# https://platform.openai.com/api-keys; Chat Completions; model gpt-4o-mini.
# Pricing (Nov 2024): $0.15/M input, $0.60/M output. Budget caps enforced in 3.7b.
OPENAI_API_KEY=sk-REPLACE_ME
```

### Step 1 — openai-client.ts

```ts
// backend/src/ai/openai-client.ts
export type ChatRequest = {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  max_completion_tokens: number;
  response_format: { type: 'json_object' };
  temperature?: number;
};
export type ChatResponse = {
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number };
};

export class OpenAIError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message); this.name = 'OpenAIError';
  }
}

export async function callChat(payload: ChatRequest): Promise<ChatResponse> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new OpenAIError('OPENAI_API_KEY not set');
  for (let attempt = 1; attempt <= 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if ((res.status === 429 || res.status >= 500) && attempt === 1) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }
      if (!res.ok) throw new OpenAIError(`OpenAI ${res.status}`, res.status);
      return (await res.json()) as ChatResponse;
    } catch (e) {
      clearTimeout(timer);
      if (attempt === 2) throw e instanceof OpenAIError ? e : new OpenAIError(String(e));
    }
  }
  throw new OpenAIError('unreachable');
}
```

### Step 2 — prompts/lookup-summary.ts

```ts
// backend/src/ai/prompts/lookup-summary.ts
export const SYSTEM_PROMPT = `You are RentGuard, an information assistant for NYC renters.
Generate a plain-English risk summary from the public records below.

Strict rules:
- Cite source counts. Say "47 open HPD violations", never "many violations".
- Do not characterize the building, owner, or manager beyond literal records.
- Do not say "bad", "scam", "slumlord", "avoid", "good", or other verdict words.
- Do not advise the user whether to rent.
- Word limit: 120 words for "summary".
- End the "summary" with this exact sentence: "Always check the cited records yourself before relying on anything in this summary."

Output strict JSON only:
{
  "summary": "<text, ≤120 words, ending with the required closing sentence>",
  "indicators": [
    { "key": "<short label>", "value": "<literal count or fact>", "source_url": "<NYC Open Data URL>" }
  ]
}`;

export type BuildingPayload = {
  bbl: string;
  address: string;
  borough: string;
  hpdViolations: { open: number; closed: number };
  dobComplaints: number;
  evictions: number;
  bedbugReports: number;
  leadFlags: number;
  registeredOwner: string | null;
  watchlistRank: number | null;
};

export function buildUserPrompt(p: BuildingPayload): string {
  return `Building: ${p.address} (${p.borough}, BBL ${p.bbl})

Public records (last 24h cache):
- HPD violations: ${p.hpdViolations.open} open, ${p.hpdViolations.closed} closed
- DOB complaints: ${p.dobComplaints}
- Marshal evictions on file: ${p.evictions}
- Bedbug reports filed: ${p.bedbugReports}
- Lead paint inspection findings: ${p.leadFlags}
- HPD registered owner: ${p.registeredOwner ?? 'not registered'}
- NYC Public Advocate Worst Landlord Watchlist rank: ${p.watchlistRank ?? 'not on list'}

Source URLs to cite (use these exact URLs in indicator source_url):
- https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5
- https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv
- https://data.cityofnewyork.us/City-Government/Marshal-Evictions/6z8x-wfk4
- https://advocate.nyc.gov/landlord-watchlist/

Write a 120-word summary plus 3-6 indicators.`;
}
```

### Step 3 — summary.ts

```ts
// backend/src/ai/summary.ts
import { callChat } from './openai-client.js';
import { SYSTEM_PROMPT, buildUserPrompt, type BuildingPayload } from './prompts/lookup-summary.js';
import { getDb } from '../db/client.js';
import { aiUsage } from '../db/schema.js';
import { logger } from '../logger.js';

const MAX_INPUT_CHARS = 16_000; // ~4K tokens
const PRICE_INPUT_PER_M = 0.15;
const PRICE_OUTPUT_PER_M = 0.60;

export class TokenBudgetError extends Error { constructor() { super('input exceeds 4K token budget'); this.name = 'TokenBudgetError'; } }
export class MalformedAIResponse extends Error { constructor(msg: string) { super(msg); this.name = 'MalformedAIResponse'; } }

export type SummaryResult = {
  summary: string;
  indicators: Array<{ key: string; value: string; source_url: string }>;
  cost_cents: number;
  ai_usage_id: string;
};

export type SummarySubject =
  | { type: 'user_id'; value: string }
  | { type: 'email'; value: string }
  | { type: 'anon_token'; value: string };

export async function generateSummary(
  payload: BuildingPayload,
  subject: SummarySubject,
): Promise<SummaryResult> {
  const userPrompt = buildUserPrompt(payload);
  if (SYSTEM_PROMPT.length + userPrompt.length > MAX_INPUT_CHARS) throw new TokenBudgetError();

  const res = await callChat({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 1000,
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const raw = res.choices[0]?.message.content;
  if (!raw) throw new MalformedAIResponse('empty content');
  let parsed: { summary?: string; indicators?: unknown[] };
  try { parsed = JSON.parse(raw); } catch { throw new MalformedAIResponse('not json'); }
  if (typeof parsed.summary !== 'string') throw new MalformedAIResponse('missing summary');
  if (!Array.isArray(parsed.indicators)) throw new MalformedAIResponse('missing indicators');

  const inputCents = (res.usage.prompt_tokens * PRICE_INPUT_PER_M) / 10_000;
  const outputCents = (res.usage.completion_tokens * PRICE_OUTPUT_PER_M) / 10_000;
  const cost_cents = Math.max(1, Math.ceil(inputCents + outputCents));

  const [usage] = await getDb()
    .insert(aiUsage)
    .values({
      userId: subject.type === 'user_id' ? subject.value : null,
      email: subject.type === 'email' ? subject.value : null,
      route: 'lookup',
      costCents: cost_cents,
      modelUsed: 'gpt-4o-mini',
    })
    .returning({ id: aiUsage.id });
  logger.info({ cost_cents, ai_usage_id: usage.id, subject_type: subject.type });

  return {
    summary: parsed.summary,
    indicators: parsed.indicators as Array<{ key: string; value: string; source_url: string }>,
    cost_cents,
    ai_usage_id: usage.id,
  };
}
```

*(Note: `aiUsage` schema doesn't currently have an `anon_token` column. Phase 1.5 schema only has `user_id` + `email`. For anon usage, set both to null and rely on cost-cap logic looking at `building_lookups.anon_token` instead. Document in code comment.)*

### Tests (10)

1. Cost: prompt=1000, completion=500 → cents = `ceil(1000*0.15/10000 + 500*0.60/10000) = 1` (after Math.max(1, ...)).
2. Cost: prompt=10_000, completion=2_000 → cents = `ceil(10000*0.15/10000 + 2000*0.60/10000) = ceil(0.15 + 0.12) = 1`.
3. Mocked successful call: returns `{summary, indicators}`, writes `aiUsage` row.
4. Mocked 429 → retries → success on retry.
5. Mocked 429 twice → throws `OpenAIError`.
6. Mocked 500 once → retries → success.
7. Mocked malformed JSON content → throws `MalformedAIResponse`.
8. Input prompt > 16K chars → throws `TokenBudgetError`.
9. Missing `OPENAI_API_KEY` → throws on first call.
10. Manual eval (skipped in CI): generate for 5 known BBLs, log to `manual-eval.fixtures.md`. Each entry: BBL, prompt char count, summary, indicators, reviewer initials, pass/fail (cites numbers? avoids verdict words? ends with required sentence?).

### Definition of done

- [ ] `OPENAI_API_KEY` documented in `.env.example`.
- [ ] 10 tests pass (9 automated + 1 manual eval logged).
- [ ] All 5 manual eval summaries pass the 3 quality checks.
- [ ] Total cost across 5 manual evals < $0.05.

### Commit
```
feat: Phase 3.7 — gpt-4o-mini summary generation with cost logging
```

---

## Phase 3.7b — AI cost guardrails (LAUNCH GATE)

**🚦 BLOCKS PUBLIC TRAFFIC. Must ship and verify before exposing 3.8.**

### Files to create / modify

```
backend/drizzle/0009_phase_3_7b_cost_alerts.sql              # NEW
backend/src/ai/
  cost-cap.ts
backend/src/db/schema.ts                                      # MODIFY: add costAlerts table
backend/scripts/verify-restore.ts                             # MODIFY: assert cost_alerts table + cron job
backend/RUNBOOK.md                                            # MODIFY: add §9 Cost monitoring
backend/test/ai/cost-cap.integration.test.ts                  # NEW
```

### Step 0 — migration

```sql
-- backend/drizzle/0009_phase_3_7b_cost_alerts.sql
CREATE TABLE IF NOT EXISTS public.cost_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('user_id', 'email', 'anon_token')),
  subject_value text NOT NULL,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  total_cost_cents integer NOT NULL,
  threshold_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (subject_type, subject_value, window_start, window_end)
);
ALTER TABLE public.cost_alerts ENABLE ROW LEVEL SECURITY;
-- no policies → service-role-only

CREATE OR REPLACE FUNCTION public.aggregate_costs() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  threshold_cents integer := 500; -- $5 over 30 days
BEGIN
  INSERT INTO public.cost_alerts (subject_type, subject_value, window_start, window_end, total_cost_cents, threshold_cents)
  SELECT 'user_id', user_id::text, NOW() - interval '30 days', NOW(), SUM(cost_cents), threshold_cents
  FROM public.ai_usage
  WHERE user_id IS NOT NULL AND created_at > NOW() - interval '30 days'
  GROUP BY user_id
  HAVING SUM(cost_cents) > threshold_cents
  ON CONFLICT (subject_type, subject_value, window_start, window_end) DO NOTHING;

  INSERT INTO public.cost_alerts (subject_type, subject_value, window_start, window_end, total_cost_cents, threshold_cents)
  SELECT 'email', email, NOW() - interval '30 days', NOW(), SUM(cost_cents), threshold_cents
  FROM public.ai_usage
  WHERE email IS NOT NULL AND created_at > NOW() - interval '30 days'
  GROUP BY email
  HAVING SUM(cost_cents) > threshold_cents
  ON CONFLICT (subject_type, subject_value, window_start, window_end) DO NOTHING;
END;
$$;

-- pg_cron schedule (only if extension available; idempotent)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('rentguard-cost-aggregate', '0 4 * * *', 'SELECT public.aggregate_costs();');
  END IF;
END $$;
```

*(Note: local Supabase CLI ships pg_cron disabled by default. The DO block guards on extension existence, so migrations apply cleanly on local + cloud. Cloud Supabase has pg_cron by default. Document this in RUNBOOK §9.)*

### Step 1 — schema.ts add `costAlerts` table mirroring the SQL.

### Step 2 — cost-cap.ts

```ts
// backend/src/ai/cost-cap.ts
import { getDb } from '../db/client.js';
import { aiUsage, buildingLookups } from '../db/schema.js';
import { sql, and, gte, eq } from 'drizzle-orm';

export const COST_CAPS_24H_CENTS = {
  anon_token: 20,           // $0.20
  email: 50,                // $0.50
  user_id: 500,             // $5
} as const;

export type CapSubject =
  | { type: 'user_id'; value: string }
  | { type: 'email'; value: string }
  | { type: 'anon_token'; value: string };

export type CapCheck = { ok: true } | { ok: false; cap_cents: number; spent_cents: number };

export async function checkCostCap(subject: CapSubject): Promise<CapCheck> {
  const cap = COST_CAPS_24H_CENTS[subject.type];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  let spent = 0;

  if (subject.type === 'user_id') {
    const [r] = await getDb()
      .select({ s: sql<number>`coalesce(sum(${aiUsage.costCents}), 0)::int` })
      .from(aiUsage)
      .where(and(eq(aiUsage.userId, subject.value), gte(aiUsage.createdAt, since)));
    spent = r?.s ?? 0;
  } else if (subject.type === 'email') {
    const [r] = await getDb()
      .select({ s: sql<number>`coalesce(sum(${aiUsage.costCents}), 0)::int` })
      .from(aiUsage)
      .where(and(eq(aiUsage.email, subject.value), gte(aiUsage.createdAt, since)));
    spent = r?.s ?? 0;
  } else {
    // anon_token: ai_usage doesn't have anon_token column; use building_lookups join
    const [r] = await getDb()
      .select({ s: sql<number>`coalesce(sum(${buildingLookups.aiCostCents}), 0)::int` })
      .from(buildingLookups)
      .where(and(eq(buildingLookups.anonToken, subject.value), gte(buildingLookups.createdAt, since)));
    spent = r?.s ?? 0;
  }

  return spent < cap ? { ok: true } : { ok: false, cap_cents: cap, spent_cents: spent };
}
```

### Step 3 — wire `checkCostCap` into `generateSummary` (3.7) at the top:

```ts
// backend/src/ai/summary.ts (modify)
const cap = await checkCostCap({ type: subject.type, value: subject.value });
if (!cap.ok) throw new CostCapExceededError(cap.cap_cents, cap.spent_cents);
```

Add `CostCapExceededError` to `summary.ts`. Phase 3.8 catches it and returns 402.

### Step 4 — verify-restore.ts additions

```ts
// in scripts/verify-restore.ts, add to the assertions list:
assert('cost_alerts table exists', /* SELECT FROM information_schema.tables */);
assert('cost_alerts has RLS enabled', /* SELECT relrowsecurity FROM pg_class */);
assert('aggregate_costs function exists', /* SELECT FROM pg_proc */);
```

### Step 5 — RUNBOOK §9

Add new section "Cost monitoring" to `backend/RUNBOOK.md`:
- How to query `cost_alerts` in Supabase Studio.
- How to manually trigger `SELECT public.aggregate_costs();`.
- Local note: pg_cron is disabled on local Supabase; verify scheduling on cloud staging.
- Tuning: where to bump `threshold_cents` (in the SQL function).

### Tests (7)

1. Insert `aiUsage` rows summing to 19 cents (under cap=20) for an email → `checkCostCap` returns `ok: true`.
2. Insert rows summing to 20 cents → `ok: true` (cap is exclusive lower bound).
3. Insert rows summing to 21 cents → `ok: false`.
4. Insert old row (40h ago) summing 100c, plus recent 10c → check returns `ok: true` (sliding 24h window excludes old).
5. anon_token cap reads from `buildingLookups.aiCostCents` not `aiUsage` (verify by inserting `building_lookups` rows but no `ai_usage`).
6. Manual: run `SELECT public.aggregate_costs();` after seeding 30-day spend > 500c for an email → `cost_alerts` row appears.
7. Idempotent: re-run aggregate → no duplicate row (UNIQUE constraint).

### Definition of done

- [ ] Migration `0009` applies locally; `verify:restore` passes including new assertions.
- [ ] 7 tests pass.
- [ ] Manual: `psql "$DATABASE_URL" -c "SELECT public.aggregate_costs();"` succeeds.
- [ ] RUNBOOK §9 written.
- [ ] `CostCapExceededError` thrown from `generateSummary` when cap exceeded.

### Commit
```
feat: Phase 3.7b — AI cost caps + cost_alerts table + daily aggregate
```

🚦 **GATE:** Phase 3.8 is exposed to public traffic only AFTER this commit lands and `verify:restore` passes on staging.

---

## Phase 3.8 — Backend endpoint: `POST /v1/lookup`

**Goal:** master endpoint composing 3.1–3.7 + cap check + counters.

### Files to create / modify

```
backend/.env.example                             # MODIFY: add SUPABASE_JWT_SECRET, BEEHIIV_API_KEY, BEEHIIV_PUBLICATION_ID
backend/package.json                             # MODIFY: + zod, jose, hono cors (no install needed; built-in)
backend/src/middleware/
  rate-limit.ts
  anon-token.ts
  auth.ts
  cors.ts
backend/src/lib/
  counters.ts
backend/src/routes/
  v1.ts                                          # exports v1 router
  lookup.ts
  affiliate-click.ts
  waitlist-email.ts
backend/src/app.ts                               # MODIFY: mount /v1 router, install CORS + middleware
backend/test/middleware/
  rate-limit.test.ts
  anon-token.test.ts
  auth.test.ts
backend/test/routes/
  lookup.integration.test.ts
  affiliate-click.integration.test.ts
  waitlist-email.integration.test.ts
```

### Step 0 — env vars

Append to `backend/.env.example`:
```
# --- Phase 3.8: Auth ---
# Supabase JWT secret (Project Settings → API → JWT secret).
# Local dev default matches supabase/config.toml.
SUPABASE_JWT_SECRET=super-secret-jwt-token-with-at-least-32-characters-long

# --- Phase 3.9: Beehiiv (waitlist enrollment) ---
# https://app.beehiiv.com/settings/integrations/api
# Stub-able locally: if missing, /v1/waitlist/email logs the attempt and returns 200.
BEEHIIV_API_KEY=
BEEHIIV_PUBLICATION_ID=
```

### Step 1 — packages

```sh
cd backend
npm install zod jose
```

### Step 2 — middleware

**`cors.ts`:**
```ts
import { cors } from 'hono/cors';
const ALLOWED = [
  'http://localhost:3000', 'http://localhost:3100',
  'http://127.0.0.1:3000', 'http://127.0.0.1:3100',
  'https://rentguard.cc', 'https://www.rentguard.cc',
];
export const corsMiddleware = cors({
  origin: (origin) => {
    if (!origin) return '*';
    if (ALLOWED.includes(origin)) return origin;
    if (/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin)) return origin;
    return null;
  },
  credentials: true,
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
});
```

**`anon-token.ts`:**
```ts
import { createMiddleware } from 'hono/factory';
import { getCookie, setCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';

const COOKIE = 'rentguard-anon';
const TTL_S = 60 * 60 * 24 * 365; // 12 months

export const anonTokenMiddleware = createMiddleware(async (c, next) => {
  let token = getCookie(c, COOKIE);
  if (!token) {
    token = randomUUID();
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'Lax',
      path: '/',
      maxAge: TTL_S,
    });
  }
  c.set('anonToken', token);
  await next();
});
```

**`auth.ts`:**
```ts
import { createMiddleware } from 'hono/factory';
import { jwtVerify, createRemoteJWKSet } from 'jose';

export const authMiddleware = createMiddleware(async (c, next) => {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length);
    try {
      const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
      if (typeof payload.sub === 'string') c.set('userId', payload.sub);
      if (typeof payload.email === 'string') c.set('userEmail', payload.email);
    } catch {
      // invalid token: continue as anon
    }
  }
  await next();
});
```

**`rate-limit.ts`:**
```ts
import { createMiddleware } from 'hono/factory';

const buckets = new Map<string, number[]>();
const HOUR_MS = 60 * 60 * 1000;

function check(key: string, limit: number): boolean {
  const now = Date.now();
  const windowStart = now - HOUR_MS;
  const arr = (buckets.get(key) ?? []).filter((t) => t > windowStart);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

export const rateLimitMiddleware = createMiddleware<{
  Variables: { anonToken: string; userId?: string; userEmail?: string };
}>(async (c, next) => {
  const userId = c.get('userId');
  const email = c.get('userEmail') ?? (await c.req.json().catch(() => ({})))?.email;
  const anon = c.get('anonToken');
  let key: string, limit: number;
  if (userId) { key = `u:${userId}`; limit = 60; }
  else if (email) { key = `e:${email}`; limit = 30; }
  else { key = `a:${anon}`; limit = 10; }
  if (!check(key, limit)) {
    c.header('Retry-After', '3600');
    return c.json({ kind: 'rate_limited', message: 'Too many lookups in the last hour. Try again later.' }, 429);
  }
  await next();
});
```

*(Caveat: the `await c.req.json()` to peek at email consumes the body. Move email-based rate-limiting AFTER body parsing in the lookup handler instead. Cleaner: rate-limit only by anon/userId at middleware layer; per-email check happens inside the handler against `email_lookup_counters`. Update accordingly.)*

### Step 3 — counters

```ts
// backend/src/lib/counters.ts
import { getDb } from '../db/client.js';
import { emailLookupCounters, buildingLookups } from '../db/schema.js';
import { eq, sql, and, isNull } from 'drizzle-orm';

const FREE_ANON_LIMIT = 1;
const FREE_EMAIL_LIMIT_30D = 3;
const RESET_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

export async function countAnonLookups(anonToken: string): Promise<number> {
  const [r] = await getDb()
    .select({ c: sql<number>`count(*)::int` })
    .from(buildingLookups)
    .where(and(eq(buildingLookups.anonToken, anonToken), isNull(buildingLookups.email)));
  return r?.c ?? 0;
}

export async function countEmailLookups(email: string): Promise<number> {
  const [r] = await getDb().select().from(emailLookupCounters).where(eq(emailLookupCounters.email, email)).limit(1);
  if (!r) return 0;
  if (Date.now() - r.resetAt.getTime() > RESET_INTERVAL_MS) return 0;
  return r.count30d;
}

export async function incrementEmailCounter(email: string, anonToken: string | null): Promise<void> {
  await getDb()
    .insert(emailLookupCounters)
    .values({ email, count30d: 1, resetAt: new Date(), anonToken })
    .onConflictDoUpdate({
      target: emailLookupCounters.email,
      set: {
        count30d: sql`CASE WHEN ${emailLookupCounters.resetAt} < NOW() - interval '30 days' THEN 1 ELSE ${emailLookupCounters.count30d} + 1 END`,
        resetAt: sql`CASE WHEN ${emailLookupCounters.resetAt} < NOW() - interval '30 days' THEN NOW() ELSE ${emailLookupCounters.resetAt} END`,
        anonToken,
      },
    });
}

export const LIMITS = { FREE_ANON_LIMIT, FREE_EMAIL_LIMIT_30D, RESET_INTERVAL_MS } as const;
```

### Step 4 — lookup route

```ts
// backend/src/routes/lookup.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { parseListingUrl } from '../parse/listing-url.js';
import { geosearch } from '../geo/geosearch.js';
import { lookupLandlord } from '../data/landlord.js';
import { checkFare } from '../fare/check.js';
import { generateSummary, CostCapExceededError } from '../ai/summary.js';
import { getHpdViolations } from '../data/datasets/hpd-violations.js';
import { getDobComplaints } from '../data/datasets/dob-complaints.js';
import { getEvictions } from '../data/datasets/evictions.js';
import { getBedbug } from '../data/datasets/bedbug.js';
import { getLeadPaint } from '../data/datasets/lead-paint.js';
import { getDb } from '../db/client.js';
import { buildingLookups, nonNycWaitlist } from '../db/schema.js';
import { LIMITS, countAnonLookups, countEmailLookups, incrementEmailCounter } from '../lib/counters.js';

const Body = z.object({
  address: z.string().optional(),
  listingUrl: z.string().optional(),
  listingDescription: z.string().optional(),
  email: z.string().email().optional(),
}).refine((d) => d.address || d.listingUrl, { message: 'address or listingUrl required' });

export const lookupRoute = new Hono<{
  Variables: { anonToken: string; userId?: string; userEmail?: string };
}>();

lookupRoute.post('/lookup', async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ kind: 'invalid_input', errors: parsed.error.flatten() }, 400);
  const { address, listingUrl, listingDescription, email } = parsed.data;
  const anonToken = c.get('anonToken');
  const userId = c.get('userId');
  const userEmail = c.get('userEmail') ?? email;

  // 1. URL parse
  let resolvedAddress = address;
  if (listingUrl && !resolvedAddress) {
    const r = parseListingUrl(listingUrl);
    if (r.kind === 'requires_address') return c.json({ kind: 'requires_address', reason: r.reason });
    resolvedAddress = r.address;
  }
  if (!resolvedAddress) return c.json({ kind: 'invalid_input', errors: { address: 'required' } }, 400);

  // 2. Geocode
  const g = await geosearch(resolvedAddress);
  if (g.kind === 'outside_nyc') {
    if (userEmail) {
      await getDb().insert(nonNycWaitlist).values({
        email: userEmail,
        attemptedAddress: resolvedAddress,
        requestedCity: g.detected_city,
        requestedState: g.detected_state,
      });
    }
    return c.json({ kind: 'outside_nyc', detected_city: g.detected_city, detected_state: g.detected_state });
  }
  if (g.kind === 'ambiguous') return c.json({ kind: 'ambiguous', matches: g.matches });

  const { bbl, address: canonicalAddress, borough } = g;

  // 3. Counter check
  if (!userId) {
    if (!userEmail) {
      const n = await countAnonLookups(anonToken);
      if (n >= LIMITS.FREE_ANON_LIMIT) return c.json({ kind: 'email_gate', message: 'Drop your email to keep looking.' });
    } else {
      const n = await countEmailLookups(userEmail);
      if (n >= LIMITS.FREE_EMAIL_LIMIT_30D) return c.json({ kind: 'email_gate', message: 'You have used your 3 free lookups this month.' });
    }
  }

  // 4. Fetch data in parallel
  const [hpdV, dob, evic, bed, lead, landlord] = await Promise.all([
    getHpdViolations(bbl), getDobComplaints(bbl), getEvictions(bbl), getBedbug(bbl), getLeadPaint(bbl),
    lookupLandlord(bbl),
  ]);
  const hpdOpen = hpdV.filter((v) => v.currentstatus !== 'CLOSE').length;
  const hpdClosed = hpdV.length - hpdOpen;

  // 5. FARE check
  const fareCheck = listingUrl || listingDescription ? checkFare({ listingText: listingDescription, listingUrl }) : null;

  // 6. AI summary (with cost cap)
  const subject = userId
    ? { type: 'user_id' as const, value: userId }
    : userEmail
    ? { type: 'email' as const, value: userEmail }
    : { type: 'anon_token' as const, value: anonToken };
  let summary;
  try {
    summary = await generateSummary({
      bbl, address: canonicalAddress, borough,
      hpdViolations: { open: hpdOpen, closed: hpdClosed },
      dobComplaints: dob.length, evictions: evic.length,
      bedbugReports: bed.length, leadFlags: lead.length,
      registeredOwner: landlord.registered_owner_name, watchlistRank: landlord.watchlist_rank,
    }, subject);
  } catch (e) {
    if (e instanceof CostCapExceededError) {
      return c.json({ kind: 'cost_cap', message: "We've hit today's free cap — try again tomorrow." }, 402);
    }
    throw e;
  }

  // 7. Persist building_lookups
  const [row] = await getDb().insert(buildingLookups).values({
    userId: userId ?? null,
    email: userEmail ?? null,
    anonToken,
    addressInput: resolvedAddress,
    buildingBbl: bbl,
    aiSummary: summary.summary,
    aiCostCents: summary.cost_cents,
  }).returning({ id: buildingLookups.id });

  // 8. Increment counter (only for email lookups; anon is implicit via building_lookups count)
  if (userEmail && !userId) await incrementEmailCounter(userEmail, anonToken);

  // 9. Response
  return c.json({
    kind: 'success',
    bbl, address: canonicalAddress, borough,
    summary: summary.summary, indicators: summary.indicators,
    landlord, fare_check: fareCheck,
    stats: { hpd_violations_open: hpdOpen, hpd_violations_closed: hpdClosed,
             dob_complaints: dob.length, evictions: evic.length, bedbug_reports: bed.length, lead_flags: lead.length },
    lookup_id: row.id,
    building_url: `/building/${bbl}`,
  });
});
```

### Step 5 — affiliate-click + waitlist-email routes

```ts
// backend/src/routes/affiliate-click.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../db/client.js';
import { affiliateClicks } from '../db/schema.js';

const Body = z.object({
  partner: z.enum(['lemonade', 'bellhop', 'moved']),
  referrerUrl: z.string().url().optional(),
  proceeded: z.boolean(),
});

export const affiliateClickRoute = new Hono<{
  Variables: { anonToken: string; userId?: string };
}>();

affiliateClickRoute.post('/affiliate/click', async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ kind: 'invalid_input' }, 400);
  const { partner, referrerUrl, proceeded } = parsed.data;
  await getDb().insert(affiliateClicks).values({
    userId: c.get('userId') ?? null,
    anonToken: c.get('anonToken'),
    partner,
    referrerUrl: referrerUrl ?? null,
    clickedModalAt: new Date(),
    clickedThroughAt: proceeded ? new Date() : null,
  });
  return c.json({ ok: true });
});
```

```ts
// backend/src/routes/waitlist-email.ts
import { Hono } from 'hono';
import { z } from 'zod';
import { logger } from '../logger.js';

const Body = z.object({ email: z.string().email() });

export const waitlistEmailRoute = new Hono();
waitlistEmailRoute.post('/waitlist/email', async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ kind: 'invalid_input' }, 400);
  const { email } = parsed.data;
  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId = process.env.BEEHIIV_PUBLICATION_ID;
  if (!apiKey || !pubId) {
    logger.warn({ email }, 'beehiiv stub: would enroll');
    return c.json({ ok: true, stub: true });
  }
  const res = await fetch(`https://api.beehiiv.com/v2/publications/${pubId}/subscriptions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ email, reactivate_existing: true, send_welcome_email: true }),
  });
  if (!res.ok) return c.json({ ok: false, status: res.status }, 502);
  return c.json({ ok: true });
});
```

### Step 6 — v1 router + app.ts wiring

```ts
// backend/src/routes/v1.ts
import { Hono } from 'hono';
import { lookupRoute } from './lookup.js';
import { affiliateClickRoute } from './affiliate-click.js';
import { waitlistEmailRoute } from './waitlist-email.js';
import { buildingByBblRoute } from './building-by-bbl.js'; // Phase 3.10

export const v1Router = new Hono<{
  Variables: { anonToken: string; userId?: string; userEmail?: string };
}>();
v1Router.route('/', lookupRoute);
v1Router.route('/', affiliateClickRoute);
v1Router.route('/', waitlistEmailRoute);
v1Router.route('/', buildingByBblRoute);
```

```ts
// backend/src/app.ts (modify)
import { corsMiddleware } from './middleware/cors.js';
import { anonTokenMiddleware } from './middleware/anon-token.js';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rate-limit.js';
import { v1Router } from './routes/v1.js';

export function createApp() {
  const app = new Hono();
  app.use('*', requestLogger);
  app.use('/v1/*', corsMiddleware);
  app.use('/v1/*', anonTokenMiddleware);
  app.use('/v1/*', authMiddleware);
  app.use('/v1/lookup', rateLimitMiddleware);
  app.get('/health', /* unchanged */);
  app.route('/v1', v1Router);
  return app;
}
```

### Tests (20 across middleware + routes)

**Middleware tests (5):**
1. `anon-token`: missing cookie → response includes `Set-Cookie: rentguard-anon=…; HttpOnly; SameSite=Lax`.
2. `anon-token`: existing cookie → `c.get('anonToken')` matches.
3. `auth`: valid Supabase JWT → `c.get('userId')` populated.
4. `auth`: invalid JWT → no userId, no 401.
5. `rate-limit`: 11th request from same anon → 429 + `Retry-After: 3600`.

**Lookup route tests (15):**
1. Valid address → success with `lookup_id`, `building_url`, summary non-empty.
2. ListingUrl with parseable slug → success.
3. ListingUrl opaque → `kind: 'requires_address'`.
4. Non-NYC + email → `kind: 'outside_nyc'`, `nonNycWaitlist` row inserted.
5. Non-NYC without email → `kind: 'outside_nyc'`, no waitlist row.
6. Ambiguous → `kind: 'ambiguous'`, matches array length ≥ 2.
7. 1st anon lookup → success.
8. 2nd anon lookup (same anonToken, no email) → `kind: 'email_gate'`.
9. Email user, 3 lookups in 30d → success; 4th → `email_gate`.
10. Cost cap exceeded (seed `aiUsage` 25c for email) → 402 `kind: 'cost_cap'`.
11. Authenticated user → 60/hr limit (test 31st request still ok).
12. Body validation: empty → 400 `kind: 'invalid_input'`.
13. Body validation: `email: "not-an-email"` → 400.
14. Cache warm: 2nd identical request <500ms (assert via wall-clock).
15. `aiUsage` row written exactly once on success.

### Definition of done

- [ ] All 20 tests pass.
- [ ] Manual: `curl -X POST localhost:8080/v1/lookup -H "Content-Type: application/json" -d '{"address":"350 5th Ave New York NY"}'` returns success in <8s cold.
- [ ] Manual: 2nd identical `curl` returns in <500ms.
- [ ] CORS preflight: `curl -X OPTIONS … -H "Origin: https://rentguard.cc"` returns `Access-Control-Allow-Origin: https://rentguard.cc`.
- [ ] RUNBOOK updated with API surface section.

### Commit
```
feat: Phase 3.8 — POST /v1/lookup composing data + AI + counters + caps
```

---

## Phase 3.9 — Frontend: lookup form + result page + legal blocks

**Goal:** user-facing surface at `/lookup` (input) and `/building/[bbl]` (result, shared with 3.10).

### Files to create / modify

```
docs/legal/disclaimers.md                       # NEW — see Appendix A
frontend/.env.example                           # MODIFY: add NEXT_PUBLIC_BACKEND_URL
frontend/package.json                           # MODIFY: + vitest + @testing-library/react + happy-dom + @playwright/test
frontend/scripts/build-disclaimers.ts           # NEW — parses disclaimers.md → JSON
frontend/lib/legal/
  disclaimers.ts                                # generated by script
  disclaimers.json                              # generated artifact
frontend/lib/api/backend.ts                     # NEW
frontend/components/
  LegalFraming.tsx
  LegalFooter.tsx
  AffiliateLink.tsx
  BuildingReport.tsx
frontend/app/lookup/
  page.tsx
  LookupForm.tsx
frontend/app/building/[bbl]/
  page.tsx                                      # used by 3.9 (post-lookup view) AND 3.10 (SEO archive)
  opengraph-image.tsx                           # 3.10
frontend/app/page.tsx                           # MODIFY: hero CTA points to /lookup
frontend/vitest.config.ts                       # NEW
frontend/test/
  legal.snapshot.test.ts
  LookupForm.test.tsx
  AffiliateLink.test.tsx
frontend/e2e/
  lookup-flow.spec.ts                           # Playwright
  legal-disclaimers.spec.ts
```

### Step 0 — env + packages

```sh
cd frontend
nvm use 20
npm install zod @testing-library/react happy-dom vitest @vitejs/plugin-react @playwright/test
npx playwright install chromium
```

Append `frontend/.env.example`:
```
# --- Phase 3.8: Backend URL ---
NEXT_PUBLIC_BACKEND_URL=http://localhost:8080
```

### Step 1 — disclaimer source-of-truth

Create `docs/legal/disclaimers.md` using the exact text in **Appendix A** (below).

Create `frontend/scripts/build-disclaimers.ts`:
```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(__dirname, '../../docs/legal/disclaimers.md'), 'utf8');

function extractSection(anchor: string): string {
  const re = new RegExp(`<!-- BEGIN ${anchor} -->\\n([\\s\\S]*?)\\n<!-- END ${anchor} -->`, 'm');
  const m = md.match(re);
  if (!m) throw new Error(`section ${anchor} not found in disclaimers.md`);
  return m[1].trim();
}

const out = {
  preOutputFraming: extractSection('preOutputFraming'),
  fareActFraming: extractSection('fareActFraming'),
  affiliateClickThrough: extractSection('affiliateClickThrough'),
  weAreNotFooter: extractSection('weAreNotFooter'),
};
writeFileSync(join(__dirname, '../lib/legal/disclaimers.json'), JSON.stringify(out, null, 2));
writeFileSync(
  join(__dirname, '../lib/legal/disclaimers.ts'),
  `// AUTO-GENERATED by scripts/build-disclaimers.ts. Do not edit.\n` +
    `import json from './disclaimers.json' with { type: 'json' };\n` +
    `export const DISCLAIMERS = json as Readonly<{\n` +
    `  preOutputFraming: string;\n  fareActFraming: string;\n` +
    `  affiliateClickThrough: string;\n  weAreNotFooter: string;\n}>;\n`,
);
console.log('disclaimers built');
```

Wire into `frontend/package.json`:
```json
"scripts": {
  "build": "tsx scripts/build-disclaimers.ts && next build",
  "dev": "tsx scripts/build-disclaimers.ts && next dev",
  "test": "tsx scripts/build-disclaimers.ts && vitest run",
  "build:disclaimers": "tsx scripts/build-disclaimers.ts"
}
```

(Add `tsx` to devDependencies via `npm install -D tsx`.)

### Step 2 — backend client

```ts
// frontend/lib/api/backend.ts
import { createClient } from '@/lib/supabase/browser';

export type LookupResponse =
  | { kind: 'success'; bbl: string; address: string; borough: string; summary: string; indicators: Array<{ key: string; value: string; source_url: string }>; landlord: any; fare_check: any; stats: Record<string, number>; lookup_id: string; building_url: string }
  | { kind: 'requires_address'; reason: string }
  | { kind: 'outside_nyc'; detected_city: string | null; detected_state: string | null }
  | { kind: 'ambiguous'; matches: Array<{ bbl: string; address: string; borough: string }> }
  | { kind: 'email_gate'; message: string }
  | { kind: 'cost_cap'; message: string }
  | { kind: 'rate_limited'; message: string }
  | { kind: 'invalid_input'; errors: any };

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:8080';

async function authHeader(): Promise<HeadersInit> {
  try {
    const supabase = createClient();
    const { data: { session } } = await supabase.auth.getSession();
    return session ? { Authorization: `Bearer ${session.access_token}` } : {};
  } catch { return {}; }
}

export async function postLookup(input: { address?: string; listingUrl?: string; listingDescription?: string; email?: string }): Promise<LookupResponse> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}/v1/lookup`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(input),
  });
  return (await res.json()) as LookupResponse;
}

export async function postAffiliateClick(input: { partner: 'lemonade' | 'bellhop' | 'moved'; referrerUrl?: string; proceeded: boolean }): Promise<void> {
  const auth = await authHeader();
  await fetch(`${BASE}/v1/affiliate/click`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(input),
  });
}

export async function postWaitlistEmail(email: string): Promise<void> {
  await fetch(`${BASE}/v1/waitlist/email`, {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

export async function getBuildingByBbl(bbl: string): Promise<LookupResponse> {
  const res = await fetch(`${BASE}/v1/building/${bbl}`, { credentials: 'include', cache: 'force-cache', next: { revalidate: 86400 } });
  return (await res.json()) as LookupResponse;
}
```

### Step 3 — components

**`LegalFraming.tsx`:**
```tsx
import { DISCLAIMERS } from '@/lib/legal/disclaimers';
export function LegalFraming() {
  return (
    <aside className="legal-framing" aria-label="AI-generated content notice">
      <p>{DISCLAIMERS.preOutputFraming}</p>
    </aside>
  );
}
```

**`LegalFooter.tsx`:**
```tsx
import { DISCLAIMERS } from '@/lib/legal/disclaimers';
export function LegalFooter() {
  return (
    <footer className="legal-footer" aria-label="Legal disclosures">
      <pre>{DISCLAIMERS.weAreNotFooter}</pre>
    </footer>
  );
}
```

**`AffiliateLink.tsx`:**
```tsx
'use client';
import { useState } from 'react';
import { DISCLAIMERS } from '@/lib/legal/disclaimers';
import { postAffiliateClick } from '@/lib/api/backend';

export function AffiliateLink({ partner, href, label }: { partner: 'lemonade' | 'bellhop' | 'moved'; href: string; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="affiliate-cta" onClick={() => { setOpen(true); postAffiliateClick({ partner, proceeded: false }).catch(() => {}); }}>
        {label}
      </button>
      {open && (
        <div role="dialog" className="affiliate-modal">
          <p>{DISCLAIMERS.affiliateClickThrough}</p>
          <button onClick={async () => { await postAffiliateClick({ partner, referrerUrl: href, proceeded: true }); window.open(href, '_blank', 'noopener,noreferrer'); setOpen(false); }}>Continue</button>
          <button onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
    </>
  );
}
```

**`BuildingReport.tsx`:** renders summary + indicators + landlord + FARE + affiliates. (~150 lines; standard React; uses `LegalFraming` above summary, `LegalFooter` at bottom.)

### Step 4 — `/lookup/page.tsx` and `LookupForm.tsx`

```tsx
// frontend/app/lookup/page.tsx
import { Suspense } from 'react';
import { LookupForm } from './LookupForm';
export default function LookupPage() {
  return <main className="lookup-shell"><Suspense fallback={<p>Loading…</p>}><LookupForm /></Suspense></main>;
}
```

```tsx
// frontend/app/lookup/LookupForm.tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { postLookup, postWaitlistEmail, type LookupResponse } from '@/lib/api/backend';

export function LookupForm() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [resp, setResp] = useState<LookupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState('');

  async function submit(extras: { email?: string } = {}) {
    setLoading(true);
    const isUrl = /^https?:\/\//i.test(input);
    const r = await postLookup({ ...(isUrl ? { listingUrl: input } : { address: input }), ...extras });
    setLoading(false);
    setResp(r);
    if (r.kind === 'success') router.push(`/building/${r.bbl}?fresh=1`);
  }

  return (
    <div>
      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="NYC address or listing URL" />
      <button onClick={() => submit()} disabled={loading}>{loading ? 'Looking…' : 'Look up'}</button>
      {resp?.kind === 'requires_address' && <p>We could not extract an address from that URL. Paste the building address.</p>}
      {resp?.kind === 'ambiguous' && resp.matches.map((m) => (
        <button key={m.bbl} onClick={() => router.push(`/building/${m.bbl}`)}>{m.address} — {m.borough}</button>
      ))}
      {resp?.kind === 'outside_nyc' && (
        <form onSubmit={async (e) => { e.preventDefault(); await postWaitlistEmail(email); alert('Saved.'); }}>
          <p>{resp.detected_city} is outside our coverage area. Drop your email and we'll let you know when we expand.</p>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit">Save my spot</button>
        </form>
      )}
      {resp?.kind === 'email_gate' && (
        <form onSubmit={async (e) => { e.preventDefault(); submit({ email }); }}>
          <p>{resp.message}</p>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <button type="submit">Continue</button>
        </form>
      )}
      {resp?.kind === 'cost_cap' && <p>{resp.message}</p>}
      {resp?.kind === 'rate_limited' && <p>{resp.message}</p>}
      {resp?.kind === 'invalid_input' && <p>Please enter a valid address or URL.</p>}
    </div>
  );
}
```

### Step 5 — `/building/[bbl]/page.tsx`

```tsx
// frontend/app/building/[bbl]/page.tsx
import { notFound } from 'next/navigation';
import { getBuildingByBbl } from '@/lib/api/backend';
import { BuildingReport } from '@/components/BuildingReport';

export const revalidate = 86400;

export async function generateMetadata({ params }: { params: Promise<{ bbl: string }> }) {
  const { bbl } = await params;
  return { title: `Building ${bbl} — RentGuard NYC`, description: `Public-records risk summary for ${bbl}` };
}

export default async function BuildingPage({ params }: { params: Promise<{ bbl: string }> }) {
  const { bbl } = await params;
  const r = await getBuildingByBbl(bbl);
  if (r.kind !== 'success') notFound();
  return <BuildingReport data={r} />;
}
```

### Step 6 — vitest config + tests

`frontend/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  test: { environment: 'happy-dom', globals: true },
  resolve: { alias: { '@': new URL('.', import.meta.url).pathname } },
});
```

**Snapshot tests:**
```ts
// frontend/test/legal.snapshot.test.ts
import { DISCLAIMERS } from '@/lib/legal/disclaimers';
import { readFileSync } from 'node:fs';

it('preOutputFraming matches source markdown', () => {
  const md = readFileSync('docs/legal/disclaimers.md', 'utf8');
  const m = md.match(/<!-- BEGIN preOutputFraming -->\n([\s\S]*?)\n<!-- END preOutputFraming -->/);
  expect(m?.[1].trim()).toBe(DISCLAIMERS.preOutputFraming);
});

it('weAreNotFooter matches source markdown', () => { /* same pattern */ });
```

**Component tests:**
- `LookupForm` submits to mocked backend; on `success` calls `router.push`.
- `LookupForm` on `email_gate` shows email input.
- `AffiliateLink` opens modal; clicking Continue calls `postAffiliateClick({ proceeded: true })`.

**Playwright (run after implementation):**
- Enter "350 5th Ave New York NY" → land on `/building/1008440007`.
- Verify pre-output framing visible above summary.
- Verify "We Are Not" footer visible at bottom.
- 2nd lookup with same browser session → email gate fires.

### Definition of done

- [ ] `npm run build` succeeds (which includes disclaimer build).
- [ ] All vitest tests pass (snapshot + component).
- [ ] All Playwright tests pass.
- [ ] Manual QA on 5 different NYC addresses.
- [ ] Editing `docs/legal/disclaimers.md` and rebuilding propagates to UI (tested manually).

### Commit
```
feat: Phase 3.9 — lookup form, result page, legal disclaimers (single-source)
```

---

## Phase 3.10 — Public archive + SEO

**Goal:** indexable `/building/[bbl]` pages (already created in 3.9), sitemap, robots, OG image, structured data.

### Files to create

```
backend/src/routes/building-by-bbl.ts        # GET /v1/building/:bbl
backend/test/routes/building-by-bbl.integration.test.ts
frontend/app/sitemap.ts
frontend/app/robots.ts
frontend/app/building/[bbl]/opengraph-image.tsx
frontend/lib/seo/structured-data.ts
frontend/components/BuildingReport.tsx       # MODIFY: inject JSON-LD
docs/runbook/seo-cost-optimization.md        # 3.10b deferred-work doc
```

### Step 1 — backend `GET /v1/building/:bbl`

```ts
// backend/src/routes/building-by-bbl.ts
import { Hono } from 'hono';
import { getDb } from '../db/client.js';
import { buildings, buildingLookups } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { lookupLandlord } from '../data/landlord.js';
import { getHpdViolations } from '../data/datasets/hpd-violations.js';
import { getDobComplaints } from '../data/datasets/dob-complaints.js';
import { getEvictions } from '../data/datasets/evictions.js';
import { getBedbug } from '../data/datasets/bedbug.js';
import { getLeadPaint } from '../data/datasets/lead-paint.js';
import { generateSummary, CostCapExceededError } from '../ai/summary.js';

export const buildingByBblRoute = new Hono();

buildingByBblRoute.get('/building/:bbl', async (c) => {
  const bbl = c.req.param('bbl');
  if (!/^\d{10}$/.test(bbl)) return c.json({ kind: 'not_found' }, 404);

  const [b] = await getDb().select().from(buildings).where(eq(buildings.bbl, bbl)).limit(1);
  if (!b) return c.json({ kind: 'not_found' }, 404);

  const [latest] = await getDb()
    .select({ summary: buildingLookups.aiSummary })
    .from(buildingLookups)
    .where(eq(buildingLookups.buildingBbl, bbl))
    .orderBy(desc(buildingLookups.createdAt))
    .limit(1);

  const [hpdV, dob, evic, bed, lead, landlord] = await Promise.all([
    getHpdViolations(bbl), getDobComplaints(bbl), getEvictions(bbl), getBedbug(bbl), getLeadPaint(bbl), lookupLandlord(bbl),
  ]);
  const hpdOpen = hpdV.filter((v) => v.currentstatus !== 'CLOSE').length;

  let summary = latest?.summary;
  let indicators: Array<{ key: string; value: string; source_url: string }> = [];
  if (!summary) {
    try {
      const r = await generateSummary({
        bbl, address: b.address, borough: b.borough,
        hpdViolations: { open: hpdOpen, closed: hpdV.length - hpdOpen },
        dobComplaints: dob.length, evictions: evic.length, bedbugReports: bed.length, leadFlags: lead.length,
        registeredOwner: landlord.registered_owner_name, watchlistRank: landlord.watchlist_rank,
      }, { type: 'anon_token', value: `seo:${bbl}` });
      summary = r.summary;
      indicators = r.indicators;
    } catch (e) {
      if (e instanceof CostCapExceededError) summary = 'Summary temporarily unavailable.';
      else throw e;
    }
  }

  return c.json({
    kind: 'success', bbl, address: b.address, borough: b.borough,
    summary, indicators, landlord, fare_check: null,
    stats: { hpd_violations_open: hpdOpen, hpd_violations_closed: hpdV.length - hpdOpen, dob_complaints: dob.length, evictions: evic.length, bedbug_reports: bed.length, lead_flags: lead.length },
    lookup_id: '', building_url: `/building/${bbl}`,
  });
});
```

### Step 2 — sitemap + robots

```ts
// frontend/app/sitemap.ts
import type { MetadataRoute } from 'next';
import { createClient } from '@/lib/supabase/server';

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient();
  const { data } = await supabase.from('buildings').select('bbl, last_fetched_at').not('last_fetched_at', 'is', null).limit(50_000);
  const urls = (data ?? []).map((row) => ({
    url: `https://rentguard.cc/building/${row.bbl}`,
    lastModified: new Date(row.last_fetched_at),
    changeFrequency: 'weekly' as const,
  }));
  return [
    { url: 'https://rentguard.cc/', changeFrequency: 'daily' },
    { url: 'https://rentguard.cc/lookup', changeFrequency: 'daily' },
    ...urls,
  ];
}
```

```ts
// frontend/app/robots.ts
import type { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: '*', allow: '/' }], sitemap: 'https://rentguard.cc/sitemap.xml' };
}
```

### Step 3 — OG image

```tsx
// frontend/app/building/[bbl]/opengraph-image.tsx
import { ImageResponse } from 'next/og';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function Image({ params }: { params: { bbl: string } }) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/v1/building/${params.bbl}`, { next: { revalidate: 86400 } });
  const data = await res.json() as { kind: string; address?: string; stats?: { hpd_violations_open: number } };
  const headline = data.kind === 'success' ? `${data.stats?.hpd_violations_open ?? 0} open HPD violations` : 'Building report';
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 80, background: '#0a0a0a', color: 'white', fontFamily: 'system-ui' }}>
        <p style={{ fontSize: 32, opacity: 0.6 }}>RentGuard NYC</p>
        <p style={{ fontSize: 64, fontWeight: 800 }}>{data.address ?? params.bbl}</p>
        <p style={{ fontSize: 48 }}>{headline}</p>
      </div>
    ),
    size,
  );
}
```

### Step 4 — structured data (JSON-LD)

```ts
// frontend/lib/seo/structured-data.ts
export function buildingJsonLd(data: { address: string; bbl: string; summary: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Place',
    name: data.address,
    identifier: data.bbl,
    description: data.summary.slice(0, 280),
  };
}
```

Inject in `BuildingReport.tsx`:
```tsx
<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(buildingJsonLd(...)) }} />
```

### Step 5 — 3.10b doc

Create `docs/runbook/seo-cost-optimization.md` documenting the deferred Batch API plan: switch SEO summary path to OpenAI Batch API once archive ≥ 1000 buildings AND monthly OpenAI spend ≥ $50. Includes pseudocode for the cron pattern.

### Tests

**Backend (4):**
1. `GET /v1/building/1008440007` after a successful lookup → returns success with cached summary.
2. `GET /v1/building/0000000000` → 404.
3. `GET /v1/building/notdigits` → 404 (regex fail).
4. New BBL with no lookup history → triggers AI summary, persists in `building_lookups`.

**Frontend (manual + automated):**
5. `curl -s http://localhost:3000/sitemap.xml` → contains `<url>` for at least one BBL.
6. `curl -s http://localhost:3000/robots.txt` → contains `Sitemap: https://rentguard.cc/sitemap.xml`.
7. Open `http://localhost:3000/building/1008440007/opengraph-image` → returns 1200×630 PNG.
8. Visit `/building/1008440007` → page renders, `<script type="application/ld+json">` present in HTML.
9. Manual: paste page URL into Google's Rich Results test → no errors.

### Definition of done

- [ ] `GET /v1/building/:bbl` works for 5 indexed BBLs.
- [ ] Sitemap includes them.
- [ ] OG image renders for 3 distinct BBLs (visual sanity check).
- [ ] Structured data validates in Rich Results test.
- [ ] `docs/runbook/seo-cost-optimization.md` exists.
- [ ] Lighthouse on `/building/[bbl]` ≥ 95.

### Commit
```
feat: Phase 3.10 — public /building/[bbl] archive + sitemap + OG + JSON-LD
```

---

## End-to-end verification (run after 3.10 ships)

```sh
cd <repo-root>

# 1. Backend: full suite + verify scripts
cd backend
supabase start
npm run migrate                  # applies 0008 + 0009
npm run verify:restore           # 47/47 (was 44/44 + cost_alerts assertions)
npm test                         # ≥ 200 tests passing
npm run verify:data-sources      # exit 0

# 2. Frontend: build + tests
cd ../frontend
nvm use 20
npm install
npm run build                    # disclaimer build + next build, both succeed
npm test                         # vitest snapshots + component
npx playwright test              # E2E

# 3. Local end-to-end happy path (manual, 5 minutes)
cd ../backend && npm run dev &
cd ../frontend && npm run dev &
# In browser:
# - http://localhost:3000/lookup
# - enter "350 5th Ave New York NY" → redirects to /building/1008440007
# - confirm summary visible, framing visible above, footer visible below
# - click an affiliate CTA → modal appears with §4.1 text → click Continue → opens partner URL
# - back on /lookup, enter another address → see email gate → submit email → success
# - enter "1600 Pennsylvania Ave" → see waitlist capture → submit
# - http://localhost:3000/building/1008440007 → SEO page renders directly
# - http://localhost:3000/sitemap.xml → contains the BBL
# - http://localhost:3000/robots.txt → contains sitemap reference

# 4. Cost guardrails sanity
psql "$DATABASE_URL" -c "SELECT subject_value, total_cost_cents FROM cost_alerts ORDER BY created_at DESC LIMIT 5;"
psql "$DATABASE_URL" -c "SELECT public.aggregate_costs();"  # idempotent

# 5. Manual eval log
cat backend/test/ai/manual-eval.fixtures.md  # ≥5 entries with reviewer initials
```

**Phase 3 Complete when ALL of these are true:**
- [ ] All 11 sub-phase definitions of done checked.
- [ ] `cost_alerts` table empty under normal traffic; populates under synthetic abuse.
- [ ] Snapshot tests for legal blocks pass (byte-identical to source).
- [ ] ≥5 buildings indexed; sitemap renders them; OG images render.
- [ ] README acceptance section updated with Phase 3.x rows.
- [ ] All commits pushed to `main`; Vercel + Render deploys green.
- [ ] Render staging survives 50 lookups without hitting cost cap.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| OpenAI cost runaway from abuser | 3.7b | Per-subject 24h cap + nightly aggregate; **launch gate** |
| Defamation suit from AI summary | 3.7, 3.9 | System prompt forbids verdict words; pre-output framing + footer byte-identical to attorney source |
| UPL via FARE Act tool | 3.6, 3.9 | `flag` enum (never `compliant: bool`); explanation copy uses DCWP framing |
| Geosearch downtime | 3.2 | `GeocodeError('unavailable')` surfaces friendly message; lookup fails closed |
| Socrata rate-limiting | 3.1 | App token raises to 10k/hr; 24h cache; retry once on 429 |
| Sitemap >50K URLs | 3.10 | `.limit(50_000)` in sitemap.ts; partition pattern documented when crossing 40K |
| Render free-tier in-memory rate-limit reset on redeploy | 3.8 | Documented in source comment; acceptable for v1 |
| Anon-cookie loss → re-faces email gate | 3.8, 3.9 | 12-month TTL; documented in Privacy Policy §6.1 |
| Disclaimer copy drift between source + UI | 3.9, 3.10 | Build-time parser + snapshot tests; CI fails on drift |
| Beehiiv credentials missing in dev | 3.9 | Stub mode (logs intent + 200) so dev doesn't block |
| pg_cron unavailable on local Supabase | 3.7b | DO block guards on extension; local skips schedule, cloud runs |

---

## Sequencing summary

| Order | Phase | Critical-path? | Notes |
|---|---|---|---|
| 1 | 3.1 | yes | Foundation for 3.4, 3.7, 3.10 |
| 2 | 3.2 | yes | Required by 3.8 |
| 3 | 3.3 | parallel-safe | Pure regex; can land alongside 3.4–3.6 |
| 4 | 3.4 | yes | Owner display required by 3.9 |
| 5 | 3.5 | parallel-safe | Watchlist enrichment; defer if blocked |
| 6 | 3.6 | parallel-safe | Pure regex |
| 7 | 3.7 | yes | AI summary central to value prop |
| 8 | **3.7b** | **🚦 launch gate** | **Must precede public traffic on 3.8** |
| 9 | 3.8 | yes | Composes everything above |
| 10 | 3.9 | yes | User-facing surface |
| 11 | 3.10 | yes | SEO surface; foundation for organic growth |

---

# Appendix A — Stub disclaimer copy for `docs/legal/disclaimers.md`

Create `docs/legal/disclaimers.md` with this content. **Stub copy** for development; replace with attorney-finalized text when Phase 0.1 closes. The build-time parser locates sections by HTML comment anchors, so attorneys can edit the prose freely between the markers without breaking anything.

```markdown
# RentGuard NYC — Legal Disclosures

> ⚠️ STUB COPY for development. Phase 0.1 attorney sign-off replaces this content with finalized language. Do not ship the stub to production traffic without legal review.

## §1.3 — Pre-output framing for AI summaries

<!-- BEGIN preOutputFraming -->
The summary below was written by an AI model from public records. It can contain mistakes, miss context, or summarize records inaccurately. It is not legal, medical, or financial advice, and it is not a verdict on this building, its owner, or whether you should rent here. Always check the cited records yourself before relying on anything in this summary.
<!-- END preOutputFraming -->

## §3.2 — FARE Act framing

<!-- BEGIN fareActFraming -->
RentGuard does not enforce the FARE Act and does not determine whether a particular listing violates it. Only the New York City Department of Consumer and Worker Protection (DCWP) decides FARE Act violations. The patterns below are descriptive observations of the listing text — not legal conclusions. To file a complaint, visit https://www.nyc.gov/site/dca/about/FARE-Act.page.
<!-- END fareActFraming -->

## §4.1 — Affiliate click-through disclosure

<!-- BEGIN affiliateClickThrough -->
RentGuard NYC earns a commission if you purchase through this link. We only recommend services we would use ourselves, but the commission is real and you should weigh it. By continuing, you acknowledge this disclosure.
<!-- END affiliateClickThrough -->

## §5 — "We Are Not" footer

<!-- BEGIN weAreNotFooter -->
RentGuard NYC is not a law firm, broker, real-estate agent, advocacy organization, government agency, or licensed inspector. We do not give legal, financial, or housing advice. Information here is summarized from public records and may be incomplete or out of date. Always verify with the cited source and consult a licensed professional for advice specific to your situation. © RentGuard NYC. Not legal advice.
<!-- END weAreNotFooter -->
```

---

# Appendix B — Files referenced

**Schema tables already in place (Phases 1.3–1.6):**
`buildings`, `landlords`, `building_lookups`, `email_lookup_counters`, `subscriptions`, `affiliate_clicks`, `ai_usage`, `non_nyc_waitlist`, `refunds`, plus `lease-pdfs` and `firm-logos` storage buckets.

**To be created in Phase 3:**
- 2 migrations: `0008_phase_3_4_landlord_link.sql`, `0009_phase_3_7b_cost_alerts.sql`.
- ~32 backend source files (`data/`, `geo/`, `parse/`, `fare/`, `ai/`, `routes/`, `middleware/`, `lib/`).
- ~18 backend test files.
- ~14 frontend files (pages, components, libs, scripts).
- ~5 frontend test files.
- 4 docs: `docs/legal/disclaimers.md`, `docs/runbook/seo-cost-optimization.md`, updates to `docs/data-sources.md`, RUNBOOK §9.
- README acceptance updates for 3.1–3.10.

**Roadmap source:** `RENTGUARD_ROADMAP_v6.md` (private; kept outside the repo) — Phase 3 section.
