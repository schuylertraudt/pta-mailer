ALTER TYPE "public"."campaign_status" ADD VALUE 'scheduled' BEFORE 'sending';--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "scheduled_by" uuid;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "schedule_error" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_scheduled_by_officers_id_fk" FOREIGN KEY ("scheduled_by") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;