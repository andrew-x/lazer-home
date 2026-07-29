CREATE TABLE "company_contact_relationships" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "company_contact_relationships_unique" UNIQUE("company_id","contact_id")
);
--> statement-breakpoint
ALTER TABLE "company_contact_relationships" ADD CONSTRAINT "company_contact_relationships_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_contact_relationships" ADD CONSTRAINT "company_contact_relationships_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "company_contact_relationships_contact_idx" ON "company_contact_relationships" USING btree ("contact_id");