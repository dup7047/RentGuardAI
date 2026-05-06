# NYC Open Data — RentGuard data source inventory

This document is the canonical reference for every NYC Open Data (Socrata) endpoint
RentGuard reads from. It is consumed by:

- the verification script at `scripts/verify-data-sources.ts` (the resource IDs
  and primary-key fields here are the contract that script tests),
- the building-lookup ingestion jobs added in Phase 2,
- the Phase 0.3 acceptance check.

Every endpoint exposes the [Socrata Open Data API (SODA) 2.1](https://dev.socrata.com/),
which means a request looks like:

```
GET https://data.cityofnewyork.us/resource/<resource_id>.json?<SoQL params>
X-App-Token: <NYC_OPEN_DATA_APP_TOKEN>
```

Without an app token, requests succeed but are subject to a stricter (~1k/hr)
shared rate limit. With a registered app token, the limit rises to ~10k/hr per
token. See `docs/nyc-open-data-token.md` for how to register.

All examples below use `$limit=1` so they're cheap to run.

---

## 1. HPD Housing Maintenance Code Violations (full history)

- **Resource ID:** `wvxf-dwi5`
- **Catalog page:** https://data.cityofnewyork.us/Housing-Development/Housing-Maintenance-Code-Violations/wvxf-dwi5
- **JSON endpoint:** https://data.cityofnewyork.us/resource/wvxf-dwi5.json
- **Primary key field:** `violationid`
- **Owner agency:** NYC Department of Housing Preservation and Development (HPD)
- **Refresh cadence:** Daily (Socrata "automation" feed). RentGuard refresh: nightly cron at 03:00 ET.
- **Why we use it:** The core dataset for the building risk score. Each row is one
  violation issued under the NYC Housing Maintenance Code or NY State Multiple
  Dwelling Law. Includes both open and closed violations, so we can compute
  rolling counts (e.g. "Class C violations issued in last 12 months").

### Key fields

| Field | Type | Notes |
|---|---|---|
| `violationid` | text | Primary key. |
| `buildingid` | text | HPD's internal building identifier. Joins to `tesw-yqqr.buildingid`. |
| `bbl` | text | 10-digit Borough-Block-Lot. **Primary join key for RentGuard's `buildings` table.** |
| `bin` | text | 7-digit Building Identification Number (DOB). |
| `housenumber` / `streetname` / `boro` / `zip` | text | Address. |
| `apartment` / `story` | text | Unit-level location of the violation. |
| `class` | text | A / B / C / I — severity (C = immediately hazardous). |
| `inspectiondate` | floating_timestamp | When inspector found the condition. |
| `currentstatus` | text | `OPEN` / `CLOSE` / etc. |
| `currentstatusdate` | floating_timestamp | Last status transition. |
| `novdescription` | text | Notice of Violation description (the "what's wrong"). |
| `originalcertifybydate` / `newcertifybydate` | floating_timestamp | Compliance deadline. |
| `latitude` / `longitude` | text (decimal) | Geo. |

### Sample query

```bash
curl -s "https://data.cityofnewyork.us/resource/wvxf-dwi5.json?\$limit=1" \
  -H "X-App-Token: $NYC_OPEN_DATA_APP_TOKEN"
```

### Useful filtered query (open Class C violations for one building)

```
GET /resource/wvxf-dwi5.json?
  bbl=1009990001
  &class=C
  &currentstatus=OPEN
  &$select=violationid,inspectiondate,novdescription,class
  &$order=inspectiondate DESC
```

---

## 2. HPD Multiple Dwelling Registrations

- **Resource ID:** `tesw-yqqr`
- **Catalog page:** https://data.cityofnewyork.us/Housing-Development/Multiple-Dwelling-Registrations/tesw-yqqr
- **JSON endpoint:** https://data.cityofnewyork.us/resource/tesw-yqqr.json
- **Primary key field:** `registrationid`
- **Owner agency:** HPD
- **Refresh cadence:** Daily; ownership data turns over slowly so RentGuard refresh: weekly (Sundays 04:00 ET).
- **Why we use it:** Gives every legally registered residential building in NYC
  with its current registration ID. The `registrationid` joins forward into
  Registration Contacts (`feu5-w2e2`) to get the actual landlord/owner names —
  which is how we build the "landlord watchlist" feature.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `registrationid` | text | Primary key. **Required** to join to Registration Contacts. |
| `buildingid` | text | HPD building ID, joins back to `wvxf-dwi5`. |
| `bbl` | text | 10-digit BBL. |
| `bin` | text | DOB BIN. |
| `housenumber` / `lowhousenumber` / `highhousenumber` / `streetname` / `boroid` / `boro` / `zip` | text | Address. |
| `block` / `lot` | text | Tax block & lot. |
| `lastregistrationdate` | floating_timestamp | When the owner last filed (HPD requires annual filing). |
| `registrationenddate` | floating_timestamp | Expiration of current registration (out-of-compliance buildings have `registrationenddate < today`). |

---

## 3. HPD Registration Contacts

- **Resource ID:** `feu5-w2e2`
- **Catalog page:** https://data.cityofnewyork.us/Housing-Development/Registration-Contacts/feu5-w2e2
- **JSON endpoint:** https://data.cityofnewyork.us/resource/feu5-w2e2.json
- **Primary key field:** `registrationcontactid`
- **Owner agency:** HPD
- **Refresh cadence:** Daily; refresh weekly with Multiple Dwelling Registrations.
- **Why we use it:** Names the actual humans/entities behind a building.
  The `type` column distinguishes the role (Owner, HeadOfficer, CorporateOwner, Agent,
  SiteManager, Lessee, JointOwner, etc.). The "Corporation" types are the
  primary signal we use to roll up multiple buildings under one landlord for
  the watchlist.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `registrationcontactid` | text | Primary key. |
| `registrationid` | text | Joins to `tesw-yqqr.registrationid`. |
| `type` | text | `HeadOfficer`, `IndividualOwner`, `CorporateOwner`, `Agent`, `SiteManager`, etc. |
| `contactdescription` | text | Free-form descriptor. |
| `corporationname` | text | Set when `type` includes "Corporate". **Used for landlord-rollup.** |
| `firstname` / `middleinitial` / `lastname` / `title` | text | Individual name fields. |
| `businesshousenumber` / `businessstreetname` / `businesscity` / `businessstate` / `businesszip` | text | Business address. |

---

## 4. DOB Complaints Received

- **Resource ID:** `eabe-havv`
- **Catalog page:** https://data.cityofnewyork.us/Housing-Development/DOB-Complaints-Received/eabe-havv
- **JSON endpoint:** https://data.cityofnewyork.us/resource/eabe-havv.json
- **Primary key field:** `complaint_number`
- **Owner agency:** NYC Department of Buildings (DOB)
- **Refresh cadence:** Daily; RentGuard refresh: nightly with HPD Violations.
- **Why we use it:** Construction / structural / illegal-conversion / no-permit
  complaints filed against a building. Different signal than HPD (which is
  about habitability inside an existing legal unit); DOB tells us about
  building-fabric and zoning issues.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `complaint_number` | text | Primary key. |
| `bin` | text | DOB BIN — joins to HPD via the `wvxf-dwi5.bin` field. |
| `house_number` / `house_street` / `zip_code` | text | Address. |
| `community_board` | text | Borough + community board number. |
| `complaint_category` | text | DOB complaint category code (numeric, see DOB lookup). |
| `date_entered` | floating_timestamp | When the complaint was filed. |
| `disposition_code` / `disposition_date` | text / floating_timestamp | How DOB resolved the complaint. |
| `inspection_date` | floating_timestamp | When DOB inspected. |
| `status` | text | `ACTIVE`, `CLOSED`, etc. |

---

## 5. 311 Service Requests (2020 – Present)

- **Resource ID:** `erm2-nwe9`
- **Catalog page:** https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2020-to-Present/erm2-nwe9
- **JSON endpoint:** https://data.cityofnewyork.us/resource/erm2-nwe9.json
- **Primary key field:** `unique_key`
- **Owner agency:** NYC 311 (DoITT)
- **Refresh cadence:** Daily, large dataset (>30M rows). RentGuard refresh: nightly,
  filtered server-side via SoQL `$where=agency='HPD' OR agency='DOB'` to keep volume manageable.
- **Why we use it:** Tenant-reported issues that may not yet have escalated to
  HPD violations or DOB complaints. The "early warning" signal — heat, noise,
  rodents, mold, water leaks reported by current residents.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `unique_key` | text | Primary key. |
| `created_date` | floating_timestamp | When the resident filed the 311. |
| `agency` | text | Routing agency (`HPD`, `DOB`, `DEP`, `DOHMH`, etc.). |
| `complaint_type` | text | Top-level category (`HEAT/HOT WATER`, `UNSANITARY CONDITION`, `PLUMBING`, etc.). |
| `descriptor` | text | More specific (`ENTIRE BUILDING`, `APARTMENT ONLY`, etc.). |
| `incident_address` / `street_name` / `incident_zip` / `borough` | text | Address. |
| `bbl` | text | 10-digit BBL — sometimes null, fall back to address geocode. |
| `status` | text | `Open`, `Closed`, `In Progress`, etc. |
| `resolution_description` | text | What the agency did. |
| `resolution_action_updated_date` | floating_timestamp | Last action timestamp. |
| `latitude` / `longitude` | text | Geo. |

### Filter-on-fetch query (RentGuard ingestion)

```
GET /resource/erm2-nwe9.json?
  $where=agency in('HPD','DOB','DEP','DOHMH') AND created_date > '2024-01-01T00:00:00.000'
  &$select=unique_key,created_date,agency,complaint_type,descriptor,bbl,incident_zip,status
  &$limit=50000
```

---

## 6. Evictions (NYC Marshal Evictions)

- **Resource ID:** `6z8x-wfk4`
- **Catalog page:** https://data.cityofnewyork.us/City-Government/Evictions/6z8x-wfk4
- **JSON endpoint:** https://data.cityofnewyork.us/resource/6z8x-wfk4.json
- **Primary key field:** `court_index_number`
- **Owner agency:** NYC Department of Investigation (DOI) — Bureau of Marshals
- **Refresh cadence:** Weekly. RentGuard refresh: weekly (Mondays 04:00 ET).
- **Why we use it:** Buildings with frequent recent evictions are a strong
  predictor of landlord aggressiveness. We surface a "X evictions in last
  24 months at this building" badge on the result page.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `court_index_number` | text | Primary key (NYS court case number). |
| `docket_number` | text | Marshal docket. |
| `eviction_address` / `eviction_apt_num` | text | Address. |
| `executed_date` | floating_timestamp | When the eviction was carried out by the marshal. |
| `marshal_first_name` / `marshal_last_name` | text | Executing marshal. |
| `residential_commercial_ind` | text | `Residential` or `Commercial`. **Filter to Residential for our use case.** |
| `borough` / `zip` | text | Geo. |
| `bbl` | text | 10-digit BBL. |
| `bin` | text | DOB BIN. |
| `latitude` / `longitude` | text | Geo. |
| `eviction_legal_possession` | text | `Possession` (full eviction) vs. `Legal Possession` (warrant only). |

---

## 7. Bedbug Reporting

- **Resource ID:** `wz6d-d3jb`
- **Catalog page:** https://data.cityofnewyork.us/Housing-Development/Bedbug-Reporting/wz6d-d3jb
- **JSON endpoint:** https://data.cityofnewyork.us/resource/wz6d-d3jb.json
- **Primary key field:** `unique_key` (Socrata-assigned `:id`-style; consult catalog if a different stable key surfaces in your snapshot)
- **Owner agency:** HPD (collected per Local Law 69 of 2017 — annual landlord disclosure of bedbug history)
- **Refresh cadence:** Annual (filings due Dec 31, posted in Q1). RentGuard refresh: monthly to capture corrections.
- **Why we use it:** Per LL 69, every multiple dwelling owner must disclose
  the prior year's bedbug infestation history before lease signing. We surface
  the per-building stat directly on the result page.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `building_id` | text | HPD building ID. |
| `bbl` | text | 10-digit BBL. |
| `bin` | text | DOB BIN. |
| `house_number` / `street_name` / `borough` / `zip` | text | Address. |
| `filing_period` | text | e.g. `2023` (the year the disclosure covers). |
| `filing_date` | floating_timestamp | When landlord filed. |
| `infested_dwelling_unit_count` | number | **Headline metric.** Number of units with infestation in filing period. |
| `eradicated_unit_count` | number | Units the landlord reports as treated/cleared. |
| `re_infested_dwelling_unit_count` | number | Units that recurred after treatment. |

---

## 8. HPD Lead Paint Violations

- **Resource ID:** `au8t-hgv2`
- **Catalog page:** https://data.cityofnewyork.us/Housing-Development/HPD-Lead-Paint-Violations/au8t-hgv2
- **JSON endpoint:** https://data.cityofnewyork.us/resource/au8t-hgv2.json
- **Primary key field:** `violationid`
- **Owner agency:** HPD
- **Refresh cadence:** Daily. RentGuard refresh: nightly with HPD Violations.
- **Why we use it:** Lead paint history is a federally mandated landlord
  disclosure (EPA 40 CFR 745) for any pre-1978 building, and especially
  important if the unit is being rented to a household with a child under 6
  (NYC Local Law 1 of 2004). Surfacing prior violations protects renters
  during lease signing.

### Key fields

| Field | Type | Notes |
|---|---|---|
| `violationid` | text | Primary key. |
| `buildingid` | text | HPD building ID. |
| `bbl` | text | 10-digit BBL. |
| `bin` | text | DOB BIN. |
| `housenumber` / `streetname` / `boro` / `zip` | text | Address. |
| `apartment` | text | Unit. |
| `class` | text | Always `C` (lead paint is class C / immediately hazardous by definition). |
| `inspectiondate` | floating_timestamp | When found. |
| `currentstatus` | text | `OPEN` / `CLOSE`. |
| `currentstatusdate` | floating_timestamp | Last status transition. |
| `novdescription` | text | Description. |
| `originalcertifybydate` / `newcertifybydate` | floating_timestamp | Compliance deadline. |

---

## Refresh-cadence summary

| Source | RentGuard refresh window | Reason |
|---|---|---|
| HPD Violations (`wvxf-dwi5`) | Nightly 03:00 ET | High-velocity, drives risk score. |
| HPD Lead Paint (`au8t-hgv2`) | Nightly 03:00 ET | Subset of HPD with same upstream cadence. |
| DOB Complaints (`eabe-havv`) | Nightly 03:00 ET | High-velocity. |
| 311 Service Requests (`erm2-nwe9`) | Nightly 03:00 ET, filtered to housing agencies | High-volume; filtered to keep ingest under 100 MB/night. |
| HPD Registrations (`tesw-yqqr`) | Weekly Sun 04:00 ET | Ownership turns over slowly. |
| HPD Registration Contacts (`feu5-w2e2`) | Weekly Sun 04:00 ET | Joined to Registrations. |
| NYC Marshal Evictions (`6z8x-wfk4`) | Weekly Mon 04:00 ET | Source publishes weekly. |
| Bedbug Reporting (`wz6d-d3jb`) | Monthly 1st 04:00 ET | Annual filing window; monthly catches corrections. |

## Rate-limit notes

- Without an app token, all endpoints share a small per-IP throttle (~1k/hr).
- With an app token (one per environment), each token gets ~10k/hr.
- The ingestion job in Phase 2 paginates with `$offset` and uses
  `$order=:id` to make pagination stable across snapshots.
- For initial backfills (>1M rows on `wvxf-dwi5` and `erm2-nwe9`), use
  `$limit=50000` per page and tolerate a multi-hour run.

## Acceptance criteria for Phase 0.3

The acceptance criteria from the roadmap are:

> `curl https://data.cityofnewyork.us/resource/... -H "X-App-Token: ..."`
> succeeds for each documented endpoint; `docs/data-sources.md` lists every
> endpoint, its primary key, and its refresh cadence.

To validate, run **from your local machine** (the dev sandbox blocks
`data.cityofnewyork.us`):

```bash
cd backend
NYC_OPEN_DATA_APP_TOKEN=<your-token> npm run verify:data-sources
```

The script reports per-endpoint pass/fail (HTTP 200 + the documented primary
key field present in the first row). If you don't yet have a token, run it
without — it'll still pass against the unauthenticated rate limit, just slower.
