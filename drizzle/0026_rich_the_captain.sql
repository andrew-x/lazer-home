CREATE TYPE "public"."time_entry_category" AS ENUM('PTO', 'UNALLOCATED_BENCH', 'INTERNAL_ADMIN');--> statement-breakpoint
CREATE TYPE "public"."timesheet_status" AS ENUM('draft', 'submitted');--> statement-breakpoint
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
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timesheet_id_timesheets_id_fk" FOREIGN KEY ("timesheet_id") REFERENCES "public"."timesheets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_timesheet_idx" ON "time_entries" USING btree ("timesheet_id");--> statement-breakpoint
CREATE INDEX "timesheets_staff_idx" ON "timesheets" USING btree ("staff_id");