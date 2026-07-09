-- Backfill legacy rows (comp was added nullable in 0017) so SET NOT NULL succeeds.
-- These are pre-compensation employment rows; 0 / CAD is a placeholder that a
-- subsequent import overwrites with real values on the next effective-dated row.
UPDATE "staff_employment" SET "base" = 0 WHERE "base" IS NULL;--> statement-breakpoint
UPDATE "staff_employment" SET "hourly_rate" = 0 WHERE "hourly_rate" IS NULL;--> statement-breakpoint
UPDATE "staff_employment" SET "guaranteed_bonus" = 0 WHERE "guaranteed_bonus" IS NULL;--> statement-breakpoint
UPDATE "staff_employment" SET "discretionary_bonus" = 0 WHERE "discretionary_bonus" IS NULL;--> statement-breakpoint
UPDATE "staff_employment" SET "currency" = 'CAD' WHERE "currency" IS NULL;--> statement-breakpoint
ALTER TABLE "staff_employment" ALTER COLUMN "base" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_employment" ALTER COLUMN "hourly_rate" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_employment" ALTER COLUMN "guaranteed_bonus" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_employment" ALTER COLUMN "discretionary_bonus" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "staff_employment" ALTER COLUMN "discretionary_bonus" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_employment" ALTER COLUMN "currency" SET NOT NULL;