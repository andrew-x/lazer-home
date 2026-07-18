CREATE TYPE "public"."project_role_status" AS ENUM('tentative', 'confirmed');--> statement-breakpoint
ALTER TABLE "projects" DROP CONSTRAINT "projects_opportunity_id_opportunities_id_fk";
--> statement-breakpoint
DROP INDEX "projects_opportunity_idx";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "project_roles" ADD COLUMN "opportunity_id" text;--> statement-breakpoint
ALTER TABLE "project_roles" ADD COLUMN "status" "project_role_status" DEFAULT 'tentative' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunities_project_idx" ON "opportunities" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_roles_opportunity_idx" ON "project_roles" USING btree ("opportunity_id");--> statement-breakpoint
-- Backfill the inverted link (opportunities.project_id) from the old
-- projects.opportunity_id before that column is dropped below.
UPDATE "opportunities" o SET "project_id" = p."id" FROM "projects" p WHERE p."opportunity_id" = o."id";--> statement-breakpoint
-- Tag each existing role with its project's originating opportunity (provenance).
UPDATE "project_roles" r SET "opportunity_id" = p."opportunity_id" FROM "projects" p WHERE r."project_id" = p."id" AND p."opportunity_id" IS NOT NULL;--> statement-breakpoint
-- Roles whose originating opportunity is already won are confirmed, not tentative.
UPDATE "project_roles" r SET "status" = 'confirmed' FROM "opportunities" o WHERE r."opportunity_id" = o."id" AND o."status" = 'closed_won';--> statement-breakpoint
ALTER TABLE "projects" DROP COLUMN "opportunity_id";