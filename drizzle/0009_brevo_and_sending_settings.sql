CREATE TABLE "sending_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"provider" text,
	"paused_until" timestamp with time zone,
	"pause_reason" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sending_settings_singleton" CHECK ("sending_settings"."id"),
	CONSTRAINT "sending_settings_provider" CHECK ("sending_settings"."provider" in ('ses', 'brevo'))
);
--> statement-breakpoint
ALTER TABLE "subscribers" ADD COLUMN "confirm_email_due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sending_settings" ADD CONSTRAINT "sending_settings_updated_by_officers_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;