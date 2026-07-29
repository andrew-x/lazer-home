-- Carry the old single-purpose `contacts.manager_id` self-FK across to the
-- unified `contact_relationships` junction (created in 0014) as `reports_to`
-- rows. Hand-added, like the data steps in 0002 and 0008: drizzle-kit emits DDL
-- only, and this MUST run before the DROP COLUMN below or the data is gone.
--
-- Ids are minted here rather than by the app, so they read `crel-<uuid hex>`
-- instead of `crel-<cuid2>` — same prefix convention, opaque either way, and the
-- alternative is an out-of-band script step on a continuously-migrated DB.
--
-- The `<>` guard is belt-and-braces against the no-self CHECK: a self-manager
-- shouldn't exist, and this migration is not the place to find out.
--
-- Cross-company and cyclic manager links, if any exist, are carried across AS-IS.
-- Same-company has always been an app-level rule (ADR 0022), never a DB
-- constraint, and `updateContact` never revalidated a manager's reports when the
-- manager's own company changed — so stale pairs are possible. Silently dropping
-- them would lose data; the new reads are one level deep, and the cycle check
-- only blocks *new* writes.
INSERT INTO "contact_relationships" ("id", "kind", "contact_id", "related_contact_id", "description", "created_at", "updated_at")
SELECT
	'crel-' || replace(gen_random_uuid()::text, '-', ''),
	'reports_to',
	"contacts"."id",
	"contacts"."manager_id",
	NULL,
	now(),
	now()
FROM "contacts"
WHERE "contacts"."manager_id" IS NOT NULL
	AND "contacts"."manager_id" <> "contacts"."id";
--> statement-breakpoint
ALTER TABLE "contacts" DROP CONSTRAINT "contacts_manager_id_contacts_id_fk";
--> statement-breakpoint
ALTER TABLE "contacts" DROP COLUMN "manager_id";
