CREATE TYPE "public"."feedback_rating" AS ENUM('ABOVE_AND_BEYOND', 'TOP_PERFORMER', 'SOLID_CONTRIBUTOR', 'MINOR_MISSES', 'NEEDS_IMPROVEMENT');--> statement-breakpoint
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
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_from_staff_id_staff_id_fk" FOREIGN KEY ("from_staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_to_staff_id_staff_id_fk" FOREIGN KEY ("to_staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feedback_to_staff_idx" ON "feedback" USING btree ("to_staff_id");--> statement-breakpoint
CREATE INDEX "feedback_from_staff_idx" ON "feedback" USING btree ("from_staff_id");