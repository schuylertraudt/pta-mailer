ALTER TABLE "subscribers" DROP COLUMN "grade";--> statement-breakpoint
ALTER TABLE "subscribers" DROP COLUMN "teacher";--> statement-breakpoint
-- Grade/teacher audiences no longer exist. Unused ones are removed. Ones a
-- newsletter still points at become empty committee audiences (0 recipients),
-- so an old draft can never silently widen to all families.
DELETE FROM "segments" s WHERE (s."rule" LIKE 'grade=%' OR s."rule" LIKE 'teacher=%')
  AND NOT EXISTS (SELECT 1 FROM "campaigns" c WHERE c."segment_id" = s."id");--> statement-breakpoint
DELETE FROM "subscriber_segments" ss USING "segments" s
  WHERE ss."segment_id" = s."id" AND (s."rule" LIKE 'grade=%' OR s."rule" LIKE 'teacher=%');--> statement-breakpoint
UPDATE "segments" SET "rule" = 'committee=' || "name" || ' (retired)', "name" = "name" || ' (retired)'
  WHERE "rule" LIKE 'grade=%' OR "rule" LIKE 'teacher=%';
