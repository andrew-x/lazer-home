CREATE TYPE "public"."billable_type" AS ENUM('HUB', 'GLOBAL');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('FULL_TIME', 'HOURLY');--> statement-breakpoint
CREATE TYPE "public"."line_of_business" AS ENUM('CORPORATE', 'CORE', 'FINTECH', 'COMMERCE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ENGINEER', 'DESIGNER', 'MANAGEMENT', 'SALES', 'SOLUTIONS', 'OPERATIONS', 'ARCHITECT', 'DELIVERY', 'QA');--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"linkedin_url" text,
	"github_url" text,
	"portfolio_url" text,
	"client_intro" text,
	"client_intro_updated_at" timestamp,
	"join_date" date,
	"termination_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "staff_employment" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"rippling_id" text,
	"effective_from_date" date NOT NULL,
	"line_of_business" "line_of_business" NOT NULL,
	"role" "role" NOT NULL,
	"employment_type" "employment_type" NOT NULL,
	"is_billable" boolean DEFAULT true NOT NULL,
	"utilization_target" integer DEFAULT 100 NOT NULL,
	"billable_type" "billable_type",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_employment" ADD CONSTRAINT "staff_employment_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;