CREATE TYPE "public"."lease_review_status" AS ENUM('pending', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "building_lookups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text,
	"anon_token" uuid,
	"address_input" text NOT NULL,
	"building_bbl" text,
	"ai_summary" text,
	"ai_cost_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_lookup_counters" (
	"email" text PRIMARY KEY NOT NULL,
	"count_30d" integer DEFAULT 0 NOT NULL,
	"reset_at" timestamp with time zone NOT NULL,
	"anon_token" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lease_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anon_token" uuid,
	"email" text,
	"stripe_payment_intent_id" text,
	"pdf_storage_path" text,
	"extracted_text" text,
	"ai_report" jsonb,
	"ai_cost_cents" integer DEFAULT 0 NOT NULL,
	"status" "lease_review_status" DEFAULT 'pending' NOT NULL,
	"preview_only" boolean DEFAULT true NOT NULL,
	"first_viewed_at" timestamp with time zone,
	"pdf_deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"stripe_customer_id" text,
	"deletion_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
