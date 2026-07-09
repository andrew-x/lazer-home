ALTER TABLE "contacts" ADD COLUMN "linkedin_url" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "manager_id" text;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_manager_id_contacts_id_fk" FOREIGN KEY ("manager_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;