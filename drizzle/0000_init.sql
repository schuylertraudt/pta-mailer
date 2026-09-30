CREATE TYPE "public"."campaign_status" AS ENUM('draft', 'pending_approval', 'approved', 'sending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."officer_audit_action" AS ENUM('bootstrap', 'add', 'role_change', 'deactivate', 'reactivate');--> statement-breakpoint
CREATE TYPE "public"."officer_role" AS ENUM('admin', 'sender', 'drafter');--> statement-breakpoint
CREATE TYPE "public"."send_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'skipped', 'bounced', 'complained');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('pending', 'active', 'unsubscribed', 'bounced', 'complained');--> statement-breakpoint
CREATE TYPE "public"."suppression_reason" AS ENUM('unsubscribe', 'bounce', 'complaint', 'manual');--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"public_url" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"bytes" integer NOT NULL,
	"mime_type" text NOT NULL,
	"alt_text" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assets_public_url_https" CHECK ("assets"."public_url" like 'https://%'),
	CONSTRAINT "assets_mime_type" CHECK ("assets"."mime_type" in ('image/jpeg', 'image/png', 'image/gif'))
);
--> statement-breakpoint
CREATE TABLE "brand_settings" (
	"id" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"logo_asset_id" uuid,
	"primary_color" text NOT NULL,
	"accent_color" text NOT NULL,
	"footer_text" text DEFAULT '' NOT NULL,
	"pta_mailing_address" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brand_settings_singleton" CHECK ("brand_settings"."id"),
	CONSTRAINT "brand_settings_primary_color_hex" CHECK ("brand_settings"."primary_color" ~ '^#[0-9a-fA-F]{6}$'),
	CONSTRAINT "brand_settings_accent_color_hex" CHECK ("brand_settings"."accent_color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"preheader" text DEFAULT '' NOT NULL,
	"body_json" jsonb NOT NULL,
	"rendered_html" text,
	"plaintext_body" text,
	"template_id" uuid,
	"segment_id" uuid,
	"status" "campaign_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"approved_by" uuid,
	"sent_by" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "officer_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"officer_id" uuid NOT NULL,
	"action" "officer_audit_action" NOT NULL,
	"actor_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "officers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "officer_role" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"google_sub" text,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "officers_email_lower" CHECK ("officers"."email" = lower("officers"."email")),
	CONSTRAINT "officers_active_consistent" CHECK (("officers"."active" and "officers"."deactivated_at" is null) or (not "officers"."active" and "officers"."deactivated_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rule" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sends" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"status" "send_status" DEFAULT 'queued' NOT NULL,
	"provider_message_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"officer_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriber_segments" (
	"subscriber_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriber_segments_subscriber_id_segment_id_pk" PRIMARY KEY("subscriber_id","segment_id")
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"grade" text,
	"teacher" text,
	"status" "subscriber_status" DEFAULT 'pending' NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"confirm_token" text,
	"unsubscribe_token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_email_lower" CHECK ("subscribers"."email" = lower("subscribers"."email")),
	CONSTRAINT "subscribers_unsubscribe_token_len" CHECK (length("subscribers"."unsubscribe_token") >= 43),
	CONSTRAINT "subscribers_confirm_token_len" CHECK ("subscribers"."confirm_token" is null or length("subscribers"."confirm_token") >= 43)
);
--> statement-breakpoint
CREATE TABLE "suppressions" (
	"email" text PRIMARY KEY NOT NULL,
	"reason" "suppression_reason" NOT NULL,
	"source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppressions_email_lower" CHECK ("suppressions"."email" = lower("suppressions"."email"))
);
--> statement-breakpoint
CREATE TABLE "templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"body_json" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_uploaded_by_officers_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_settings" ADD CONSTRAINT "brand_settings_logo_asset_id_assets_id_fk" FOREIGN KEY ("logo_asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_settings" ADD CONSTRAINT "brand_settings_updated_by_officers_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_created_by_officers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_approved_by_officers_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_sent_by_officers_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_audit" ADD CONSTRAINT "officer_audit_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_audit" ADD CONSTRAINT "officer_audit_actor_id_officers_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officers" ADD CONSTRAINT "officers_added_by_officers_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sends" ADD CONSTRAINT "sends_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_segments" ADD CONSTRAINT "subscriber_segments_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriber_segments" ADD CONSTRAINT "subscriber_segments_segment_id_segments_id_fk" FOREIGN KEY ("segment_id") REFERENCES "public"."segments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "templates" ADD CONSTRAINT "templates_created_by_officers_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."officers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "assets_storage_key_key" ON "assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "officer_audit_officer_id_idx" ON "officer_audit" USING btree ("officer_id");--> statement-breakpoint
CREATE INDEX "officer_audit_timestamp_idx" ON "officer_audit" USING btree ("timestamp");--> statement-breakpoint
CREATE UNIQUE INDEX "officers_email_key" ON "officers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "officers_google_sub_key" ON "officers" USING btree ("google_sub");--> statement-breakpoint
CREATE UNIQUE INDEX "segments_name_key" ON "segments" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "sends_campaign_subscriber_key" ON "sends" USING btree ("campaign_id","subscriber_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sends_provider_message_id_key" ON "sends" USING btree ("provider_message_id");--> statement-breakpoint
CREATE INDEX "sends_campaign_status_idx" ON "sends" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "sessions_officer_id_idx" ON "sessions" USING btree ("officer_id");--> statement-breakpoint
CREATE INDEX "subscriber_segments_segment_idx" ON "subscriber_segments" USING btree ("segment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_email_key" ON "subscribers" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_confirm_token_key" ON "subscribers" USING btree ("confirm_token");--> statement-breakpoint
CREATE UNIQUE INDEX "subscribers_unsubscribe_token_key" ON "subscribers" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "subscribers_status_idx" ON "subscribers" USING btree ("status");