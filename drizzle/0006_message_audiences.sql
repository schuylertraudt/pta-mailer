ALTER TABLE "campaigns" ADD COLUMN "segment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "from_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- "All subscribers" becomes an audience of its own, so drafts that had no
-- audience (which meant everyone) keep meaning everyone.
INSERT INTO "segments" ("name", "rule")
  SELECT CASE WHEN EXISTS (SELECT 1 FROM "segments" WHERE "name" = 'All subscribers') THEN 'All confirmed subscribers' ELSE 'All subscribers' END, 'all'
  WHERE NOT EXISTS (SELECT 1 FROM "segments" WHERE "rule" = 'all')
  ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
UPDATE "campaigns" SET "segment_ids" = ARRAY["segment_id"] WHERE "segment_id" IS NOT NULL;--> statement-breakpoint
UPDATE "campaigns" SET "segment_ids" = ARRAY[(SELECT "id" FROM "segments" WHERE "rule" = 'all' ORDER BY "created_at" LIMIT 1)]
  WHERE "segment_id" IS NULL AND EXISTS (SELECT 1 FROM "segments" WHERE "rule" = 'all');
