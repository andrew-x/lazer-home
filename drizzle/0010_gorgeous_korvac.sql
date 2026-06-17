ALTER TABLE "staff_employment" ALTER COLUMN "billable_type" SET DEFAULT 'HUB';--> statement-breakpoint
-- Backfill existing rows (all currently null) to the new default before the NOT
-- NULL constraint is applied.
UPDATE "staff_employment" SET "billable_type" = 'HUB' WHERE "billable_type" IS NULL;--> statement-breakpoint
ALTER TABLE "staff_employment" ALTER COLUMN "billable_type" SET NOT NULL;
