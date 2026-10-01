CREATE TABLE "send_clicks" (
	"send_id" uuid NOT NULL,
	"url" text NOT NULL,
	"clicks" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "send_clicks_send_id_url_pk" PRIMARY KEY("send_id","url")
);
--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "first_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "first_clicked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sends" ADD COLUMN "click_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "send_clicks" ADD CONSTRAINT "send_clicks_send_id_sends_id_fk" FOREIGN KEY ("send_id") REFERENCES "public"."sends"("id") ON DELETE cascade ON UPDATE no action;