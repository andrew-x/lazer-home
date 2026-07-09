CREATE TYPE "public"."currency" AS ENUM('CAD', 'USD', 'GBP', 'EUR');--> statement-breakpoint
ALTER TABLE "staff_employment" ADD COLUMN "base" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "staff_employment" ADD COLUMN "hourly_rate" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "staff_employment" ADD COLUMN "guaranteed_bonus" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "staff_employment" ADD COLUMN "discretionary_bonus" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "staff_employment" ADD COLUMN "currency" "currency";