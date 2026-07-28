CREATE TYPE "public"."compensation_plan_status" AS ENUM('DRAFT', 'COMMITTED');--> statement-breakpoint
CREATE TABLE "compensation_plan" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"status" "compensation_plan_status" DEFAULT 'DRAFT' NOT NULL,
	"effective_date" date NOT NULL,
	"created_by_user_id" text,
	"committed_by_user_id" text,
	"committed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compensation_plan_item" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"level" integer,
	"subratings" jsonb,
	"planned_amount" numeric(12, 2),
	"planned_currency" "currency",
	"rating_done" boolean DEFAULT false NOT NULL,
	"meeting_done" boolean DEFAULT false NOT NULL,
	"is_complete" boolean DEFAULT false NOT NULL,
	"evaluation_notes" text,
	"compensation_notes" text,
	"snapshot_amount" numeric(12, 2),
	"snapshot_currency" "currency",
	"snapshot_employment_type" "employment_type",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "compensation_plan_item_level_range" CHECK ("compensation_plan_item"."level" is null or ("compensation_plan_item"."level" >= 0 and "compensation_plan_item"."level" <= 4))
);
--> statement-breakpoint
ALTER TABLE "compensation_plan" ADD CONSTRAINT "compensation_plan_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_plan" ADD CONSTRAINT "compensation_plan_committed_by_user_id_user_id_fk" FOREIGN KEY ("committed_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_plan_item" ADD CONSTRAINT "compensation_plan_item_plan_id_compensation_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."compensation_plan"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compensation_plan_item" ADD CONSTRAINT "compensation_plan_item_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compensation_plan_item_plan_idx" ON "compensation_plan_item" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "compensation_plan_item_plan_staff_uq" ON "compensation_plan_item" USING btree ("plan_id","staff_id");