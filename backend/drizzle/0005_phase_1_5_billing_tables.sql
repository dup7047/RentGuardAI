CREATE TYPE "public"."affiliate_partner" AS ENUM('lemonade', 'bellhop', 'moved');--> statement-breakpoint
CREATE TYPE "public"."ai_route" AS ENUM('lookup', 'lease_preview', 'lease_full');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'canceled', 'past_due', 'trialing', 'unpaid');--> statement-breakpoint
CREATE TABLE "affiliate_clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anon_token" uuid,
	"partner" "affiliate_partner" NOT NULL,
	"referrer_url" text NOT NULL,
	"clicked_modal_at" timestamp with time zone NOT NULL,
	"clicked_through_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"commission_amount_cents" integer
);
--> statement-breakpoint
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"email" text,
	"route" "ai_route" NOT NULL,
	"cost_cents" integer NOT NULL,
	"model_used" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "non_nyc_waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"attempted_address" text NOT NULL,
	"requested_city" text NOT NULL,
	"requested_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"lease_review_id" uuid,
	"subscription_id" uuid,
	"stripe_refund_id" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"eligibility_reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_stripe_refund_id_unique" UNIQUE("stripe_refund_id")
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_subscription_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
