ALTER TYPE "public"."project_role_status" ADD VALUE 'paused';--> statement-breakpoint
ALTER TYPE "public"."project_role_status" ADD VALUE 'cancelled';--> statement-breakpoint
--> Add the role line-of-business as nullable first, backfill it from the parent
--> project's line of business, then enforce NOT NULL — the backfill must run
--> before the project column it copies from is dropped below.
ALTER TABLE "project_roles" ADD COLUMN "line_of_business" "line_of_business";--> statement-breakpoint
UPDATE "project_roles" SET "line_of_business" = "projects"."line_of_business" FROM "projects" WHERE "project_roles"."project_id" = "projects"."id";--> statement-breakpoint
ALTER TABLE "project_roles" ALTER COLUMN "line_of_business" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "line_of_business";--> statement-breakpoint
DROP TYPE "public"."project_status";
