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
	"staff_id" text NOT NULL,
	"line_of_business" "line_of_business" NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"hours_per_day" numeric(4, 2) DEFAULT 8 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_delivery_managers" ADD CONSTRAINT "project_delivery_managers_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_managers" ADD CONSTRAINT "project_delivery_managers_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_delivery_managers_staff_idx" ON "project_delivery_managers" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "project_roles_project_idx" ON "project_roles" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_roles_staff_idx" ON "project_roles" USING btree ("staff_id");