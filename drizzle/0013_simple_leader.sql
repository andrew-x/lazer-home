CREATE TYPE "public"."performance_review_note_status" AS ENUM('DRAFT', 'SHARED');--> statement-breakpoint
CREATE TABLE "performance_review_note" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"author_user_id" text,
	"note_date" date NOT NULL,
	"title" text,
	"body" text NOT NULL,
	"status" "performance_review_note_status" DEFAULT 'DRAFT' NOT NULL,
	"shared_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "performance_review_note" ADD CONSTRAINT "performance_review_note_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "performance_review_note" ADD CONSTRAINT "performance_review_note_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "performance_review_note_staff_idx" ON "performance_review_note" USING btree ("staff_id");