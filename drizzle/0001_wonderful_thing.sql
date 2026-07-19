CREATE TYPE "public"."crm_entry_kind" AS ENUM('note', 'next_step');--> statement-breakpoint
CREATE TABLE "contact_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"contact_id" text NOT NULL,
	"kind" "crm_entry_kind" NOT NULL,
	"body" text NOT NULL,
	"author_staff_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"kind" "crm_entry_kind" NOT NULL,
	"body" text NOT NULL,
	"author_staff_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_entries" ADD CONSTRAINT "contact_entries_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_entries" ADD CONSTRAINT "contact_entries_author_staff_id_staff_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_entries" ADD CONSTRAINT "opportunity_entries_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_entries" ADD CONSTRAINT "opportunity_entries_author_staff_id_staff_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contact_entries_contact_kind_created_idx" ON "contact_entries" USING btree ("contact_id","kind","created_at");--> statement-breakpoint
CREATE INDEX "opportunity_entries_opp_kind_created_idx" ON "opportunity_entries" USING btree ("opportunity_id","kind","created_at");--> statement-breakpoint
-- Backfill: preserve any existing scalar next-steps as the first entry of the new
-- log before dropping the column. Legacy rows get a synthetic (non-CUID2) id and
-- no author. `updated_at` mirrors `created_at`.
INSERT INTO "opportunity_entries" ("id", "opportunity_id", "kind", "body", "author_staff_id", "created_at", "updated_at")
SELECT 'oentry-' || gen_random_uuid()::text, "id", 'next_step', btrim("next_steps"), NULL, now(), now()
FROM "opportunities"
WHERE "next_steps" IS NOT NULL AND btrim("next_steps") <> '';--> statement-breakpoint
ALTER TABLE "opportunities" DROP COLUMN "next_steps";