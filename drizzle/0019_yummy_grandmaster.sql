CREATE TYPE "public"."self_evaluation_rating" AS ENUM('ABOVE_AND_BEYOND', 'TOP_PERFORMER', 'SOLID_CONTRIBUTOR', 'MINOR_MISSES', 'NEEDS_IMPROVEMENT');--> statement-breakpoint
CREATE TABLE "staff_self_evaluation" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"evaluation_date" date NOT NULL,
	"question_set_version" integer NOT NULL,
	"self_rating" "self_evaluation_rating" NOT NULL,
	"answers" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_self_evaluation" ADD CONSTRAINT "staff_self_evaluation_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_self_evaluation_staff_idx" ON "staff_self_evaluation" USING btree ("staff_id");