CREATE TYPE "public"."opportunity_source" AS ENUM('inbound', 'farming', 'extension', 'change_request', 'staff_referral', 'contact_referral');--> statement-breakpoint
CREATE TYPE "public"."opportunity_status" AS ENUM('maturing', 'lead', 'qualifying', 'scoping', 'closing', 'closed_lost', 'closed_won');--> statement-breakpoint
CREATE TABLE "opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"company_id" text NOT NULL,
	"source" "opportunity_source" NOT NULL,
	"status" "opportunity_status" NOT NULL,
	"next_steps" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_contacts_unique" UNIQUE("opportunity_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_owners" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_owners_unique" UNIQUE("opportunity_id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_source_contacts" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_source_contacts_unique" UNIQUE("opportunity_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "opportunity_source_staff" (
	"id" text PRIMARY KEY NOT NULL,
	"opportunity_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "opportunity_source_staff_unique" UNIQUE("opportunity_id","staff_id")
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_contacts" ADD CONSTRAINT "opportunity_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_owners" ADD CONSTRAINT "opportunity_owners_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_owners" ADD CONSTRAINT "opportunity_owners_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_source_contacts" ADD CONSTRAINT "opportunity_source_contacts_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_source_contacts" ADD CONSTRAINT "opportunity_source_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_source_staff" ADD CONSTRAINT "opportunity_source_staff_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_source_staff" ADD CONSTRAINT "opportunity_source_staff_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opportunity_contacts_contact_idx" ON "opportunity_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "opportunity_owners_staff_idx" ON "opportunity_owners" USING btree ("staff_id");--> statement-breakpoint
CREATE INDEX "opportunity_source_contacts_contact_idx" ON "opportunity_source_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "opportunity_source_staff_staff_idx" ON "opportunity_source_staff" USING btree ("staff_id");