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
ALTER TABLE "staff_rating" ADD CONSTRAINT "staff_rating_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_rating" ADD CONSTRAINT "staff_rating_evaluated_by_user_id_user_id_fk" FOREIGN KEY ("evaluated_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_rating_staff_idx" ON "staff_rating" USING btree ("staff_id");