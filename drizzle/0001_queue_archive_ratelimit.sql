CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" DROP CONSTRAINT "assets_public_url_https";--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "show_in_archive" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "sends_dispatch_idx" ON "sends" USING btree ("status","next_attempt_at");