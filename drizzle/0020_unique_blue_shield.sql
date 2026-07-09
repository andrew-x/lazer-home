ALTER TABLE "opportunities" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."opportunity_status";--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('maturing', 'lead', 'qualifying', 'scoping_awaiting_info', 'scoping', 'scoping_reviewing', 'allocating_awaiting_profiles', 'allocating_introing_profiles', 'negotiating', 'closing_awaiting_contracts', 'closing_redlining', 'closing_awaiting_signatures', 'closed_won', 'closed_lost');--> statement-breakpoint
ALTER TABLE "opportunities" ALTER COLUMN "status" SET DATA TYPE "public"."opportunity_status" USING (
	CASE "status"
		WHEN 'closing' THEN 'closing_awaiting_contracts'
		ELSE "status"
	END
)::"public"."opportunity_status";--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "position" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "opportunities" AS o SET "position" = sub.rn FROM (
	SELECT "id", row_number() OVER (PARTITION BY "status" ORDER BY "created_at") AS rn
	FROM "opportunities"
) AS sub WHERE o."id" = sub."id";--> statement-breakpoint
CREATE INDEX "opportunities_status_position_idx" ON "opportunities" USING btree ("status","position");