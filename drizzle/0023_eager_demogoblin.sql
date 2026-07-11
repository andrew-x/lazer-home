CREATE TYPE "public"."project_role_type" AS ENUM('ENGINEER', 'DESIGNER', 'ARCHITECT', 'QA', 'SPECIALIST');--> statement-breakpoint
ALTER TABLE "project_roles" ALTER COLUMN "staff_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project_roles" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "project_roles" ADD COLUMN "role_type" "project_role_type" DEFAULT 'ENGINEER' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_roles" ALTER COLUMN "role_type" DROP DEFAULT;