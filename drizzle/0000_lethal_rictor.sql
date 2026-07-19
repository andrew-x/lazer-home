CREATE TYPE "public"."crm_entry_kind" AS ENUM('note', 'next_step');--> statement-breakpoint
CREATE TYPE "public"."opportunity_source" AS ENUM('inbound', 'farming', 'extension', 'change_request', 'staff_referral', 'contact_referral');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('maturing', 'lead', 'qualifying', 'scoping_awaiting_info', 'scoping', 'scoping_reviewing', 'allocating_awaiting_profiles', 'allocating_introing_profiles', 'negotiating', 'closing_awaiting_contracts', 'closing_redlining', 'closing_awaiting_signatures', 'closed_won', 'closed_lost');--> statement-breakpoint
CREATE TYPE "public"."feedback_rating" AS ENUM('ABOVE_AND_BEYOND', 'TOP_PERFORMER', 'SOLID_CONTRIBUTOR', 'MINOR_MISSES', 'NEEDS_IMPROVEMENT');--> statement-breakpoint
CREATE TYPE "public"."project_role_status" AS ENUM('tentative', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."project_role_type" AS ENUM('ENGINEER', 'DESIGNER', 'ARCHITECT', 'QA', 'SPECIALIST');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('tentative', 'confirmed', 'paused', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."billable_type" AS ENUM('HUB', 'GLOBAL');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('CAD', 'USD', 'GBP', 'EUR', 'AED');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('FULL_TIME', 'HOURLY');--> statement-breakpoint
CREATE TYPE "public"."line_of_business" AS ENUM('CORPORATE', 'CORE', 'FINTECH', 'COMMERCE', 'DESIGN');--> statement-breakpoint
CREATE TYPE "public"."pto_type" AS ENUM('VACATION', 'STATUTORY_HOLIDAY', 'SICK_LEAVE', 'UNPAID_LEAVE', 'PARENTAL_LEAVE', 'BEREAVEMENT_LEAVE', 'COMPANY_RETREAT', 'RELIGIOUS_HOLIDAY', 'JURY_DUTY', 'LEAVE_OF_ABSENCE', 'OTHER_LEAVE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ENGINEER', 'DESIGNER', 'LEADERSHIP', 'SALES', 'SOLUTIONS', 'OPERATIONS', 'ARCHITECT', 'DELIVERY', 'QA');--> statement-breakpoint
CREATE TYPE "public"."time_entry_category" AS ENUM('PTO', 'UNALLOCATED_BENCH', 'INTERNAL_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text,
	"banned" boolean,
	"ban_reason" text,
	"ban_expires" timestamp,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"is_partner" boolean DEFAULT false NOT NULL,
	"owner_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"kind" "crm_entry_kind" NOT NULL,
	"body" text NOT NULL,
	"author_staff_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"company_id" text,
	"role" text,
	"linkedin_url" text,
	"manager_id" text,
	"owner_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_id" text NOT NULL,
	"source" "opportunity_source" NOT NULL,
	"status" "opportunity_status" NOT NULL,
	"line_of_business" "line_of_business" NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_contacts_unique" UNIQUE("opportunity_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"kind" "crm_entry_kind" NOT NULL,
	"body" text NOT NULL,
	"author_staff_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_owners" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_owners_unique" UNIQUE("opportunity_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_source_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_source_contacts_unique" UNIQUE("opportunity_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_source_staff" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_source_staff_unique" UNIQUE("opportunity_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"from_staff_id" text NOT NULL,
	"to_staff_id" text NOT NULL,
	"rating" "feedback_rating" NOT NULL,
	"context" text NOT NULL,
	"keep_doing" text,
	"stop_doing" text,
	"start_doing" text,
	"other" text,
	"message_to_recipient" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_rating" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"effective_date" date NOT NULL,
	"level" integer,
	"evaluated_by_user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staff_rating_level_range" CHECK ("staff_rating"."level" is null or ("staff_rating"."level" >= 0 and "staff_rating"."level" <= 4))
);
--> statement-breakpoint
CREATE TABLE "project_delivery_managers" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_delivery_managers_unique" UNIQUE("project_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "project_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"staff_id" text,
	"opportunity_id" text,
	"status" "project_role_status" DEFAULT 'tentative' NOT NULL,
	"name" text,
	"role_type" "project_role_type" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"hours_per_day" numeric(4, 2) DEFAULT 8 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "project_status" DEFAULT 'tentative' NOT NULL,
	"company_id" text NOT NULL,
	"line_of_business" "line_of_business" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"question_id" text NOT NULL,
	"list_response" jsonb,
	"text_response" text,
	"json_response" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "responses_staff_question_unique" UNIQUE("staff_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"rippling_id" text NOT NULL,
	"user_id" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"manager_id" text,
	"linkedin_url" text,
	"github_url" text,
	"portfolio_url" text,
	"client_intro" text,
	"client_intro_updated_at" timestamp,
	"resume" text,
	"resume_updated_at" timestamp,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"join_date" date,
	"termination_date" date,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staff_ripplingId_unique" UNIQUE("rippling_id"),
	CONSTRAINT "staff_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "staff_employment" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"effective_from_date" date NOT NULL,
	"line_of_business" "line_of_business" NOT NULL,
	"role" "role" NOT NULL,
	"employment_type" "employment_type" NOT NULL,
	"is_billable" boolean DEFAULT true NOT NULL,
	"utilization_target" integer DEFAULT 100 NOT NULL,
	"billable_type" "billable_type" DEFAULT 'HUB' NOT NULL,
	"is_management" boolean DEFAULT false NOT NULL,
	"base" numeric(12, 2) NOT NULL,
	"hourly_rate" numeric(12, 2) NOT NULL,
	"guaranteed_bonus" numeric(12, 2) NOT NULL,
	"discretionary_bonus" numeric(12, 2) DEFAULT 0 NOT NULL,
	"currency" "currency" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_pto" (
	"id" text PRIMARY KEY NOT NULL,
	"rippling_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"type" "pto_type" NOT NULL,
	"is_pending" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staff_pto_ripplingId_unique" UNIQUE("rippling_id")
);
--> statement-breakpoint
CREATE TABLE "time_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"timesheet_id" text NOT NULL,
	"date" date NOT NULL,
	"project_id" text,
	"category" time_entry_category,
	"hours" numeric(4, 2) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_target_check" CHECK (("time_entries"."project_id" is not null) <> ("time_entries"."category" is not null))
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"week_start_date" date NOT NULL,
	"status" timesheet_status DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "timesheets_staff_week_unique" UNIQUE("staff_id","week_start_date")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "companies" ADD CONSTRAINT "companies_owner_id_staff_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_entries" ADD CONSTRAINT "contact_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_entries" ADD CONSTRAINT "contact_entries_author_staff_id_staff_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_manager_id_contacts_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_owner_id_staff_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_entries" ADD CONSTRAINT "opportunity_entries_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_entries" ADD CONSTRAINT "opportunity_entries_author_staff_id_staff_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_owners" ADD CONSTRAINT "opportunity_owners_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_owners" ADD CONSTRAINT "opportunity_owners_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_source_contacts" ADD CONSTRAINT "opportunity_source_contacts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_source_contacts" ADD CONSTRAINT "opportunity_source_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_source_staff" ADD CONSTRAINT "opportunity_source_staff_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_source_staff" ADD CONSTRAINT "opportunity_source_staff_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_from_staff_id_staff_id_fk" FOREIGN KEY ("from_staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_to_staff_id_staff_id_fk" FOREIGN KEY ("to_staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_rating" ADD CONSTRAINT "staff_rating_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_rating" ADD CONSTRAINT "staff_rating_evaluated_by_user_id_user_id_fk" FOREIGN KEY ("evaluated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_managers" ADD CONSTRAINT "project_delivery_managers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_managers" ADD CONSTRAINT "project_delivery_managers_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_manager_id_staff_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_employment" ADD CONSTRAINT "staff_employment_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_pto" ADD CONSTRAINT "staff_pto_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timesheet_id_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_entries_contact_kind_created_idx" ON "contact_entries" USING btree ("contact_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "opportunities_status_position_idx" ON "opportunities" USING btree ("status","position");--> statement-breakpoint
CREATE INDEX "opportunities_project_idx" ON "opportunities" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "opportunity_contacts_contact_idx" ON "opportunity_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "opportunity_entries_opp_kind_created_idx" ON "opportunity_entries" USING btree ("opportunity_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "opportunity_owners_staff_idx" ON "opportunity_owners" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "opportunity_source_contacts_contact_idx" ON "opportunity_source_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "opportunity_source_staff_staff_idx" ON "opportunity_source_staff" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "feedback_to_staff_idx" ON "feedback" USING btree ("to_staff_id");--> statement-breakpoint
CREATE INDEX "feedback_from_staff_idx" ON "feedback" USING btree ("from_staff_id");--> statement-breakpoint
CREATE INDEX "staff_rating_staff_idx" ON "staff_rating" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "project_delivery_managers_staff_idx" ON "project_delivery_managers" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "project_roles_project_idx" ON "project_roles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_roles_staff_idx" ON "project_roles" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "project_roles_opportunity_idx" ON "project_roles" USING btree ("opportunity_id");--> statement-breakpoint
CREATE INDEX "responses_staff_idx" ON "responses" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "time_entries_timesheet_idx" ON "time_entries" USING btree ("timesheet_id");--> statement-breakpoint
CREATE INDEX "timesheets_staff_idx" ON "timesheets" USING btree ("staff_id");