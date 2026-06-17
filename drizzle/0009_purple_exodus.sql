-- Rename the `role` enum value in place: existing rows keep pointing at the
-- relabeled value, so no data migration is needed. (drizzle-kit can't detect an
-- enum-value rename and generated a destructive drop/recreate; replaced here.)
ALTER TYPE "public"."role" RENAME VALUE 'MANAGEMENT' TO 'LEADERSHIP';--> statement-breakpoint
ALTER TABLE "staff_employment" ADD COLUMN "is_management" boolean DEFAULT false NOT NULL;
