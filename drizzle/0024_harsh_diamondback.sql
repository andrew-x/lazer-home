-- Add line_of_business to opportunities and projects. The column is NOT NULL
-- with no default in the schema; backfill existing rows to 'CORE' via a
-- temporary default, then drop it so new rows must supply a value.
ALTER TABLE "opportunities" ADD COLUMN "line_of_business" "line_of_business" DEFAULT 'CORE' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "line_of_business" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "line_of_business" "line_of_business" DEFAULT 'CORE' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "line_of_business" DROP DEFAULT;--> statement-breakpoint
-- Line of business now lives on the project, not the role.
ALTER TABLE "project_roles" DROP COLUMN "line_of_business";
