ALTER TYPE "public"."line_of_business" ADD VALUE 'DESIGN';--> statement-breakpoint
ALTER TABLE "staff" ALTER COLUMN "rippling_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_pto" ALTER COLUMN "rippling_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_ripplingId_unique" UNIQUE("rippling_id");--> statement-breakpoint
ALTER TABLE "staff_pto" ADD CONSTRAINT "staff_pto_ripplingId_unique" UNIQUE("rippling_id");