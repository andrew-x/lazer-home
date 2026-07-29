CREATE TYPE "public"."project_billing_type" AS ENUM('FIXED_FEE', 'TIME_AND_MATERIALS');--> statement-breakpoint
CREATE TABLE "project_role_rates" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"role_type" "project_role_type" NOT NULL,
	"hourly_rate" numeric(12, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_role_rates_unique" UNIQUE("project_id","role_type")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "billing_type" "project_billing_type";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget_currency" "currency";--> statement-breakpoint
ALTER TABLE "project_role_rates" ADD CONSTRAINT "project_role_rates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_shape" CHECK (("projects"."billing_type" is null and "projects"."budget_amount" is null and "projects"."budget_currency" is null)
       or ("projects"."billing_type" = 'FIXED_FEE' and "projects"."budget_amount" is not null and "projects"."budget_currency" is not null)
       or ("projects"."billing_type" = 'TIME_AND_MATERIALS' and "projects"."budget_amount" is null and "projects"."budget_currency" is null));