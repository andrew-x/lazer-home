CREATE TYPE "public"."contact_relationship_kind" AS ENUM('reports_to', 'succeeds', 'related');--> statement-breakpoint
CREATE TABLE "contact_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "contact_relationship_kind" NOT NULL,
	"contact_id" text NOT NULL,
	"related_contact_id" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "contact_relationships_no_self" CHECK ("contact_relationships"."contact_id" <> "contact_relationships"."related_contact_id"),
	CONSTRAINT "contact_relationships_description_kind" CHECK (("contact_relationships"."kind" = 'related') = ("contact_relationships"."description" is not null))
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_relationships" ADD CONSTRAINT "contact_relationships_related_contact_id_contacts_id_fk" FOREIGN KEY ("related_contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_relationships_one_manager_uq" ON "contact_relationships" USING btree ("contact_id") WHERE "contact_relationships"."kind" = 'reports_to';--> statement-breakpoint
CREATE UNIQUE INDEX "contact_relationships_one_predecessor_uq" ON "contact_relationships" USING btree ("contact_id") WHERE "contact_relationships"."kind" = 'succeeds';--> statement-breakpoint
CREATE UNIQUE INDEX "contact_relationships_one_successor_uq" ON "contact_relationships" USING btree ("related_contact_id") WHERE "contact_relationships"."kind" = 'succeeds';--> statement-breakpoint
CREATE UNIQUE INDEX "contact_relationships_related_uq" ON "contact_relationships" USING btree (least("contact_id", "related_contact_id"),greatest("contact_id", "related_contact_id")) WHERE "contact_relationships"."kind" = 'related';--> statement-breakpoint
CREATE INDEX "contact_relationships_contact_idx" ON "contact_relationships" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "contact_relationships_related_contact_idx" ON "contact_relationships" USING btree ("related_contact_id");