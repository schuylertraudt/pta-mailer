CREATE TYPE "public"."data_audit_action" AS ENUM('subscriber_delete', 'subscriber_export');--> statement-breakpoint
CREATE TABLE "data_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"action" "data_audit_action" NOT NULL,
	"actor_id" uuid NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sends" DROP CONSTRAINT "sends_subscriber_id_subscribers_id_fk";
--> statement-breakpoint
ALTER TABLE "sends" ALTER COLUMN "subscriber_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "data_audit" ADD CONSTRAINT "data_audit_actor_id_officers_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "data_audit_timestamp_idx" ON "data_audit" USING btree ("timestamp");--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE set null ON UPDATE no action;