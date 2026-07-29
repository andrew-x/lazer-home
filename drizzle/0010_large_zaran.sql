CREATE TYPE "public"."compensation_plan_item_status" AS ENUM('NOT_STARTED', 'RATING_DONE', 'MEETING_DONE', 'COMPLETE');--> statement-breakpoint
ALTER TABLE "compensation_plan_item" ADD COLUMN "status" "compensation_plan_item_status" DEFAULT 'NOT_STARTED' NOT NULL;--> statement-breakpoint
-- Collapse the three workflow booleans onto the new ladder: highest set flag wins.
-- Hand-added (drizzle-kit only emits the DDL). This is deliberately lossy for
-- non-monotone combinations — `is_complete` without `rating_done` becomes
-- 'COMPLETE' — because those combinations are exactly the nonsense the exclusive
-- column exists to make unrepresentable. Must run BEFORE 0011 drops the columns.
UPDATE "compensation_plan_item" SET "status" = (CASE
  WHEN "is_complete"  THEN 'COMPLETE'
  WHEN "meeting_done" THEN 'MEETING_DONE'
  WHEN "rating_done"  THEN 'RATING_DONE'
  ELSE 'NOT_STARTED'
END)::"public"."compensation_plan_item_status";