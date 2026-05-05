CREATE TABLE "buildings" (
	"bbl" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"borough" text NOT NULL,
	"last_fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "landlords" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"registered_owner_name" text NOT NULL,
	"hpd_corporation_name" text,
	"watchlist_rank" integer,
	"last_fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
