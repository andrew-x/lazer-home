CREATE TABLE "project_delivery_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"author_staff_id" text,
	"note_date" date NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"project_health" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_delivery_notes_health_range" CHECK ("project_delivery_notes"."project_health" between 1 and 10)
);
--> statement-breakpoint
ALTER TABLE "project_delivery_notes" ADD CONSTRAINT "project_delivery_notes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_delivery_notes" ADD CONSTRAINT "project_delivery_notes_author_staff_id_staff_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_delivery_notes_project_date_idx" ON "project_delivery_notes" USING btree ("project_id","note_date" DESC NULLS LAST,"created_at" DESC NULLS LAST);