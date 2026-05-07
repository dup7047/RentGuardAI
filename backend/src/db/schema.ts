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

// Stripe subscription lifecycle states.
export const subscriptionStatus = pgEnum('subscription_status', [
  'active',
  'canceled',
  'past_due',
  'trialing',
  'unpaid',
]);

// Affiliate partner identifiers for click/conversion attribution.
export const affiliatePartner = pgEnum('affiliate_partner', [
  'lemonade',
  'bellhop',
  'moved',
]);

// Routes that trigger an AI model call, used to bucket cost in ai_usage.
export const aiRoute = pgEnum('ai_route', [
  'lookup',
  'lease_preview',
  'lease_full',
]);

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
  /** SummaryQuestion[] — 3-5 specific questions tied to records (Phase 3.7 follow-up) */
  aiQuestions: jsonb('ai_questions'),
  /** SummaryListingNote[] — verbatim-anchored notes on listing copy (Phase 3.7 follow-up) */
  aiListingNotes: jsonb('ai_listing_notes'),
  /** Phase 4.5: 2-3 sentence narrative of what the listing offers */
  aiListingSummary: text('ai_listing_summary'),
  /** Phase 4.5: AI's explanation of the deterministic score */
  aiScoreExplanation: text('ai_score_explanation'),
  /** Phase 4.5: deterministic 0-100 score */
  aiScore: integer('ai_score'),
  /** Phase 4.5: band derived from ai_score */
  aiScoreBand: text('ai_score_band'),
  /** Phase 4.5: ScoreFactor[] from src/scoring/score.ts */
  aiScoreFactors: jsonb('ai_score_factors'),
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
  // Phase 3.4: FK to the registered owner in the landlords cache.
  registeredOwnerLandlordId: uuid('registered_owner_landlord_id').references(
    () => landlords.id,
    { onDelete: 'set null' },
  ),
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

// Stripe subscription record: one row per Search Pass subscription.
// Written by the Stripe webhook handler (Phase 4.5). user_id FK →
// auth.users is added in the security migration so Drizzle doesn't
// manage Supabase's auth schema.
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),
  status: subscriptionStatus('status').notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Every time a user opens an affiliate disclosure modal or clicks through
// to a partner site. clicked_modal_at is set at modal open; clicked_through_at
// is set only if the user actually navigated to the partner.
// The conversion and commission fields are filled by the partner postback webhook.
export const affiliateClicks = pgTable('affiliate_clicks', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  anonToken: uuid('anon_token'),
  partner: affiliatePartner('partner').notNull(),
  referrerUrl: text('referrer_url').notNull(),
  clickedModalAt: timestamp('clicked_modal_at', { withTimezone: true }).notNull(),
  clickedThroughAt: timestamp('clicked_through_at', { withTimezone: true }),
  convertedAt: timestamp('converted_at', { withTimezone: true }),
  commissionAmountCents: integer('commission_amount_cents'),
});

// One row per AI model call. Feeds the Phase 3.7b cost-guardrail system
// and the founder's monthly cost review in Supabase Studio.
export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  email: text('email'),
  route: aiRoute('route').notNull(),
  costCents: integer('cost_cents').notNull(),
  modelUsed: text('model_used').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Captures email + address when a user tries to look up a non-NYC property.
// Used to gauge demand for expansion cities and notify early adopters when
// the city launches.
export const nonNycWaitlist = pgTable('non_nyc_waitlist', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  attemptedAddress: text('attempted_address').notNull(),
  requestedCity: text('requested_city').notNull(),
  requestedState: text('requested_state').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Stripe refund record. Populated by the Phase 4.6b refund-eligibility
// logic. user_id is nulled on account deletion (Privacy Policy §6.1) but
// the row is retained for 7 years per payment-record retention rules.
// lease_review_id and subscription_id are nullable so either flow can
// produce a refund independently.
export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id'),
  leaseReviewId: uuid('lease_review_id'),
  subscriptionId: uuid('subscription_id'),
  stripeRefundId: text('stripe_refund_id').notNull().unique(),
  amountCents: integer('amount_cents').notNull(),
  eligibilityReason: text('eligibility_reason').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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

// Phase 4: per-URL cache for scraped NYC listings. Service-role-only.
// Keyed by canonical URL (tracking params stripped). 7-day TTL on `data`.
// `raw_html_gz` is debug-only and dropped after 7d by a future cron.
export const scrapedListings = pgTable('scraped_listings', {
  id: uuid('id').primaryKey().defaultRandom(),
  url: text('url').notNull().unique(),
  source: text('source').notNull(),
  sourceKind: text('source_kind'),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  fetchMethod: text('fetch_method').notNull(),
  fetchCostCredits: integer('fetch_cost_credits').default(0),
  // bytea is stored as Buffer in node-postgres — Drizzle has no first-class
  // bytea type; we treat it as opaque and access via raw pool.query when needed.
  // For schema generation purposes, declaring it as text would be wrong; use
  // a custom column. Until then we omit it from the Drizzle model — cache.ts
  // uses raw pool.query directly so this is fine.
  data: jsonb('data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Phase 3.7b: rows inserted by aggregate_costs() pg function when a subject
// exceeds the $5/30-day cumulative threshold. Service-role-only (RLS enabled,
// no policies). pg_cron fires aggregate_costs() daily at 04:00 UTC on cloud.
export const costAlerts = pgTable('cost_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  subjectType: text('subject_type').notNull(),
  subjectValue: text('subject_value').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  totalCostCents: integer('total_cost_cents').notNull(),
  thresholdCents: integer('threshold_cents').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
