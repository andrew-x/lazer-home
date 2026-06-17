CREATE TYPE "public"."pto_type" AS ENUM('VACATION', 'STATUTORY_HOLIDAY', 'SICK_LEAVE', 'UNPAID_LEAVE', 'PARENTAL_LEAVE', 'BEREAVEMENT_LEAVE', 'OTHER_LEAVE');--> statement-breakpoint
CREATE TABLE "staff_pto" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"rippling_id" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"type" "pto_type" NOT NULL,
	"is_pending" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_pto" ADD CONSTRAINT "staff_pto_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;