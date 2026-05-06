# RentGuard Backend — Operations Runbook

This runbook covers backup strategy, restore procedures, and post-restore verification for the RentGuard backend and its Supabase database.

---

## Table of contents

1. [Backup strategy](#1-backup-strategy)
2. [Taking a manual backup (local dev)](#2-taking-a-manual-backup-local-dev)
3. [Taking a manual backup (cloud)](#3-taking-a-manual-backup-cloud)
4. [Restore procedure — local dev (full reset)](#4-restore-procedure--local-dev-full-reset)
5. [Restore procedure — cloud Supabase project](#5-restore-procedure--cloud-supabase-project)
6. [Post-restore verification](#6-post-restore-verification)
7. [RTO / RPO targets](#7-rto--rpo-targets)
8. [Clarifications from the Phase 1.7 restore drill](#8-clarifications-from-the-phase-17-restore-drill)

---

## 1. Backup strategy

RentGuard uses a two-layer backup approach.

### Layer A — Schema backup (the git repository)

All database schema changes live in version-controlled Drizzle migrations under `backend/drizzle/`. Replaying these migrations against any fresh Supabase instance fully recreates the schema, enums, cross-schema FKs, RLS policies, and Storage bucket configuration.

**This is the primary restore path.** Because migrations are idempotent and stored in git, a "schema disaster" (accidentally dropped tables, broken RLS, etc.) is recoverable in minutes with no data loss — you only lose rows inserted after the last data backup.

### Layer B — Data backup (Supabase snapshots)

| Tier | Backup cadence | Retention | Restore target |
|---|---|---|---|
| Free | Daily snapshots | 7 days | Manual restore to new project |
| Pro ($25/mo) | Daily + point-in-time recovery (PITR) | PITR: 7 days | Any point within the PITR window |

Free-tier snapshots are available at:  
**Supabase Dashboard → Project → Settings → Database → Backups**

**Supabase Storage files** (lease PDFs, firm logos) are **not included** in the Postgres snapshot. Storage files live in object storage and must be backed up separately if needed. In practice, lease PDFs are transient (purged at 90 days per Privacy Policy §6.1) and firm logos can be re-uploaded by B2B clients. No separate Storage backup is implemented in Phase 1.

---

## 2. Taking a manual backup (local dev)

Requires: Supabase CLI at `~/.local/bin/supabase`, local stack running (`supabase start`).

```sh
# Schema-only dump (recreates tables, RLS, policies, functions, types)
~/.local/bin/supabase db dump --local --workdir /Users/dantino/Desktop/RentGuardAI \
  -f backup-schema-$(date +%Y%m%d).sql

# Data-only dump (all table contents except the auth.* schema)
~/.local/bin/supabase db dump --local --workdir /Users/dantino/Desktop/RentGuardAI \
  --data-only -f backup-data-$(date +%Y%m%d).sql
```

The schema dump captures Supabase internals (auth functions, storage schema) **plus** your application schema. The data dump captures all table contents.

Store dumps outside the repo (they may contain sensitive data). A suitable location is `~/Desktop/RentGuardAI-backups/` or a private S3 bucket.

---

## 3. Taking a manual backup (cloud)

### Automatic daily snapshots

Available at **Supabase Dashboard → Settings → Database → Backups → Scheduled Backups**. No operator action needed — Supabase runs these automatically.

### Manual on-demand snapshot

```sh
# Requires Supabase CLI linked to the project (supabase link --project-ref <ref>)
supabase db dump --linked -f rentguard-manual-$(date +%Y%m%d).sql
```

### Downloading a backup file

1. Dashboard → Settings → Database → Backups → click the date → **Download**
2. You receive a `.pgdump` (custom-format pg_dump archive, not plain SQL).

---

## 4. Restore procedure — local dev (full reset)

Use this when: a local schema experiment went wrong, a migration needs to be re-applied from scratch, or you want to verify the restore procedure end-to-end.

**This is a destructive operation. All local data is permanently lost.**

```sh
# Step 1 — Optionally capture current state first
~/.local/bin/supabase db dump --local --workdir /path/to/RentGuardAI \
  -f /tmp/pre-reset-$(date +%Y%m%dT%H%M%S).sql

# Step 2 — Reset: drops and recreates the local Postgres database,
#           re-initialises Supabase's auth/storage schemas
cd /path/to/RentGuardAI
~/.local/bin/supabase db reset --local --workdir . --yes

# Step 3 — Replay application migrations
cd backend
npm run migrate

# Step 4 — Verify
npm run verify:restore
npm test   # requires DATABASE_URL set; all 104 tests should pass
```

**Expected output from Step 2:**
```
Resetting local database...
Recreating database...
Initialising schema...
Seeding globals from roles.sql...
WARN: no files matched pattern: supabase/seed.sql
Restarting containers...
Finished supabase db reset on branch main.
```

The `WARN: no files matched pattern: supabase/seed.sql` is normal — there is no seed file; the warning can be ignored.

---

## 5. Restore procedure — cloud Supabase project

Use this when: the production project has corrupted data, accidentally dropped schema, or you need to spin up a new staging project.

### 5a. Schema-only restore (no data loss, fastest)

This recreates the schema from scratch using the migrations already in git. Use when the schema is broken but no data was lost.

```sh
# Target: the new/recovered Supabase project
export DATABASE_URL="postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres"

cd backend
npm run migrate

# Verify
npm run verify:restore
```

### 5b. Full restore from a Supabase snapshot

Use when data was lost and you need to restore from a daily backup.

**Step 1: Prepare a new Supabase project**

1. Supabase Dashboard → New Project
2. Choose the same region as the original
3. Note the new project `<ref>` and database password

**Step 2: Download the backup**

1. Go to the *original* project (or the broken project while it still has backups)
2. Dashboard → Settings → Database → Backups → Scheduled Backups → click the target date → **Download**
3. Save as `rentguard-backup.pgdump`

**Step 3: Restore**

```sh
# Install pg_restore if not present:
#   macOS: brew install postgresql
#   Ubuntu: sudo apt-get install postgresql-client

pg_restore \
  --verbose \
  --no-acl \
  --no-owner \
  --host=db.<new-ref>.supabase.co \
  --port=5432 \
  --username=postgres \
  --dbname=postgres \
  rentguard-backup.pgdump
```

If the download is a `.sql` file (plain text format) instead of `.pgdump`:
```sh
psql postgresql://postgres:<pw>@db.<new-ref>.supabase.co:5432/postgres \
  < rentguard-backup.sql
```

**Step 4: Re-apply any migrations that post-date the backup**

```sh
DATABASE_URL="postgresql://postgres:<pw>@db.<new-ref>.supabase.co:5432/postgres" \
  npm run migrate
```

Drizzle's migration runner is idempotent — it skips migrations already in `drizzle.__drizzle_migrations`.

**Step 5: Verify**

```sh
DATABASE_URL="postgresql://postgres:<pw>@db.<new-ref>.supabase.co:5432/postgres" \
  npm run verify:restore
```

**Step 6: Update environment variables**

In Render (or wherever the backend is deployed):
- `DATABASE_URL` → new project connection string
- Storage bucket URLs (if any hardcoded references)

---

## 6. Post-restore verification

`npm run verify:restore` checks 44 conditions across 8 categories:

| Category | What is checked |
|---|---|
| 1. Public tables | All 11 application tables exist |
| 2. RLS enabled | All 11 tables have `rowsecurity = true` |
| 3. Enum types | All 4 custom enum types exist |
| 4. auth.users FKs | All 5 cross-schema FKs are present |
| 5. Drizzle migrations | ≥ 8 entries in `drizzle.__drizzle_migrations` |
| 6. Storage buckets | `lease-pdfs` (private) and `firm-logos` (public) exist |
| 7. Storage policies | `lease_pdfs_select_own` and `firm_logos_select_public` exist |
| 8. Supabase auth | `auth` schema has tables (Supabase stack is healthy) |

After a schema-only restore, run the full test suite as well:

```sh
DATABASE_URL=... npm test
```

All 104 tests must pass for the restore to be considered complete.

---

## 7. RTO / RPO targets

| Scenario | Recovery Point Objective (RPO) | Recovery Time Objective (RTO) |
|---|---|---|
| Schema corruption (no data loss) | Zero — replaying migrations recovers to exact schema | ~5 minutes |
| Full data loss — free tier snapshot | Up to 24 hours (last daily backup) | ~30 minutes |
| Full data loss — Pro tier PITR | Minutes (configurable PITR window) | ~30 minutes |
| Storage (lease PDFs) total loss | Up to 24 hours if backed up separately; otherwise irrecoverable | N/A — lease PDFs are purged at 90 days regardless |

Free tier is acceptable at zero revenue. Upgrade to Pro ($25/mo) when MRR crosses $500/mo or when any single tenant's data loss would be a support incident.

---

## 8. Clarifications from the Phase 1.7 restore drill

**Drill date:** 2026-05-06  
**Procedure used:** Local dev full reset (Section 4)  
**Result:** ✅ Complete restore in < 5 minutes, all 104 tests passed

**Findings:**

1. **`supabase db reset` WARN about missing `supabase/seed.sql` is harmless.** The repo has no Supabase-managed seed file (data seeding happens via migration scripts and test fixtures). The warning can be ignored.

2. **Storage bucket configuration is captured in migrations, not in Supabase's `supabase/migrations/` folder.** Migration `0007_phase_1_6_storage.sql` uses `ON CONFLICT (id) DO NOTHING`, so it's safe to re-run against a database that already has the buckets. After a reset, the buckets are gone and the migration recreates them correctly.

3. **`storage.objects` has a `protect_objects_delete` trigger** that prevents direct SQL deletes. The trigger respects `SET LOCAL "storage.allow_delete_query" = 'true'`. In our tests, SQL-inserted `storage.objects` rows are cleaned up with this GUC inside a transaction. This trigger survives a `db reset`.

4. **The `drizzle.__drizzle_migrations` table is recreated by `npm run migrate`** after a reset. Drizzle's migration runner re-applies all pending migrations and records them fresh.

5. **No data seeding is needed for the application to start after a restore.** The schema is stateless at start-up; data is inserted by the application at runtime.
