CREATE TYPE "public"."project_billing_type" AS ENUM('FIXED_FEE', 'TIME_AND_MATERIALS');--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "billing_type" "project_billing_type";--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget_amount" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "budget_currency" "currency";--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_budget_shape" CHECK (("projects"."billing_type" is null and "projects"."budget_amount" is null and "projects"."budget_currency" is null)
       or ("projects"."billing_type" = 'FIXED_FEE' and "projects"."budget_amount" is not null and "projects"."budget_currency" is not null)
       or ("projects"."billing_type" = 'TIME_AND_MATERIALS' and "projects"."budget_amount" is null and "projects"."budget_currency" is null));