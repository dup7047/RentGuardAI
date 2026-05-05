import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Lifecycle of a single lease review row. Status tracks the processing
// pipeline; preview_only and first_viewed_at handle the paywall side.
export const leaseReviewStatus = pgEnum('lease_review_status', [
  'pending',
  'processing',
  'ready',
  'failed',
]);

// Mirrors auth.users 1:1; created on first sign-in. The auth.users FK is
// added in the security migration (drizzle/0002_security.sql) so Drizzle
// doesn't try to manage Supabase's auth schema.
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  email: text('email').notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  // Phase 8.6 sets this when the user requests deletion; a cron purges
  // 90 days later (Privacy Policy §6.1).
  deletionRequestedAt: timestamp('deletion_requested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Anonymous free-tier counter, keyed by email before the user signs up.
// On first sign-in the backend copies this row's state onto `profiles`
// and deletes the source row.
export const emailLookupCounters = pgTable('email_lookup_counters', {
  email: text('email').primaryKey(),
  count30d: integer('count_30d').notNull().default(0),
  resetAt: timestamp('reset_at', { withTimezone: true }).notNull(),
  anonToken: uuid('anon_token').notNull(),
});

// Every building lookup the AI summarizes. user_id is null for anonymous
// flows; anon_token threads multiple anonymous lookups together within a
// browser session before email is captured. The building_bbl FK to
// public.buildings(bbl) is added in drizzle/0003_phase_1_4_security.sql.
export const buildingLookups = pgTable('building_lookups', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  email: text('email'),
  anonToken: uuid('anon_token'),
  addressInput: text('address_input').notNull(),
  buildingBbl: text('building_bbl'),
  aiSummary: text('ai_summary'),
  aiCostCents: integer('ai_cost_cents').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Public reference cache: one row per NYC building keyed by BBL
// (Borough/Block/Lot). Hydrated by the Phase 3 NYC Open Data clients;
// a 24-hour cache window is enforced in code, not the schema.
// raw_data holds the latest API payload so future fields can be added
// without requiring a re-fetch.
export const buildings = pgTable('buildings', {
  bbl: text('bbl').primaryKey(),
  address: text('address').notNull(),
  borough: text('borough').notNull(),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).defaultNow().notNull(),
  rawData: jsonb('raw_data').notNull().default({}),
});

// Public reference cache: registered owner per HPD building registration.
// Phase 3.4 fills this in; Phase 3.5 sets watchlist_rank from the Public
// Advocate Worst Landlord Watchlist. Match keys (normalized owner name)
// are derived in code, not stored as a unique index, so name variants
// can converge as the matching heuristic improves.
export const landlords = pgTable('landlords', {
  id: uuid('id').primaryKey().defaultRandom(),
  registeredOwnerName: text('registered_owner_name').notNull(),
  hpdCorporationName: text('hpd_corporation_name'),
  watchlistRank: integer('watchlist_rank'),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }).defaultNow().notNull(),
});

// One row per lease review attempt. PDF + extracted_text are nullable so
// the 90-day purge cron (Phase 8.7) can drop them while keeping the
// structured ai_report for the user's history.
export const leaseReviews = pgTable('lease_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  anonToken: uuid('anon_token'),
  email: text('email'),
  stripePaymentIntentId: text('stripe_payment_intent_id'),
  pdfStoragePath: text('pdf_storage_path'),
  extractedText: text('extracted_text'),
  aiReport: jsonb('ai_report'),
  aiCostCents: integer('ai_cost_cents').notNull().default(0),
  status: leaseReviewStatus('status').notNull().default('pending'),
  previewOnly: boolean('preview_only').notNull().default(true),
  firstViewedAt: timestamp('first_viewed_at', { withTimezone: true }),
  pdfDeletedAt: timestamp('pdf_deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
