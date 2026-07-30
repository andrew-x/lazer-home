CREATE TYPE "public"."staff_bonus_type" AS ENUM('DISCRETIONARY', 'SPOT', 'INCENTIVE', 'SIGNING', 'REFERRAL', 'GIFT');--> statement-breakpoint
CREATE TABLE "staff_bonus_payment" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"payment_date" date NOT NULL,
	"type" "staff_bonus_type" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" "currency" NOT NULL,
	"notes" text,
	"rippling_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "staff_bonus_payment_ripplingId_unique" UNIQUE("rippling_id"),
	CONSTRAINT "staff_bonus_payment_amount_positive" CHECK ("staff_bonus_payment"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "staff_bonus_payment" ADD CONSTRAINT "staff_bonus_payment_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_bonus_payment_staff_idx" ON "staff_bonus_payment" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "staff_bonus_payment_date_idx" ON "staff_bonus_payment" USING btree ("payment_date");--> statement-breakpoint
ALTER TABLE "staff_employment" DROP COLUMN "discretionary_bonus";