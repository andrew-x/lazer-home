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
ALTER TABLE "responses" ADD CONSTRAINT "responses_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "responses_staff_idx" ON "responses" USING btree ("staff_id");