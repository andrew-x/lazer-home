CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"owner_staff_id" text,
	"creator_staff_id" text,
	"done" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp,
	"company_id" text,
	"contact_id" text,
	"opportunity_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_one_parent" CHECK (num_nonnulls("tasks"."company_id", "tasks"."contact_id", "tasks"."opportunity_id") = 1)
);
--> statement-breakpoint
DROP INDEX "company_entries_company_kind_created_idx";--> statement-breakpoint
DROP INDEX "contact_entries_contact_kind_created_idx";--> statement-breakpoint
DROP INDEX "opportunity_entries_opp_kind_created_idx";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_staff_id_staff_id_fk" FOREIGN KEY ("owner_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_creator_staff_id_staff_id_fk" FOREIGN KEY ("creator_staff_id") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_contact_done_idx" ON "tasks" USING btree ("contact_id","done");--> statement-breakpoint
CREATE INDEX "tasks_opportunity_done_idx" ON "tasks" USING btree ("opportunity_id","done");--> statement-breakpoint
CREATE INDEX "tasks_company_done_idx" ON "tasks" USING btree ("company_id","done");--> statement-breakpoint
CREATE INDEX "company_entries_company_created_idx" ON "company_entries" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_entries_contact_created_idx" ON "contact_entries" USING btree ("contact_id","created_at");--> statement-breakpoint
CREATE INDEX "opportunity_entries_opp_created_idx" ON "opportunity_entries" USING btree ("opportunity_id","created_at");--> statement-breakpoint
-- Next steps were replaced by the `tasks` entity. Drop the `next_step` rows
-- before removing the `kind` column so their bodies don't resurface as notes.
DELETE FROM "company_entries" WHERE "kind" = 'next_step';--> statement-breakpoint
DELETE FROM "contact_entries" WHERE "kind" = 'next_step';--> statement-breakpoint
DELETE FROM "opportunity_entries" WHERE "kind" = 'next_step';--> statement-breakpoint
ALTER TABLE "company_entries" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "contact_entries" DROP COLUMN "kind";--> statement-breakpoint
ALTER TABLE "opportunity_entries" DROP COLUMN "kind";--> statement-breakpoint
DROP TYPE "public"."crm_entry_kind";