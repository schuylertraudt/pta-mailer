ALTER TABLE "subscribers" ADD COLUMN "school" text;--> statement-breakpoint
CREATE INDEX "subscribers_school_idx" ON "subscribers" USING btree ("school");