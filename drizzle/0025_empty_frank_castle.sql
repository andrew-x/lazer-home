--> A role's bill rate is SNAPSHOTTED from the code-owned rate card at creation, so
--> existing rows take the launch card's value: add the column nullable, backfill it,
--> then enforce NOT NULL. Drizzle generated a bare `ADD COLUMN ... NOT NULL`, which
--> cannot run against a populated table — this is the hand-edited form, following the
--> same shape as 0002_gray_corsair.sql.
-->
--> The literal below is a ONE-TIME HISTORICAL SNAPSHOT, not policy. The card lives in
--> src/lib/projects/bill-rates.ts and is never read from here: it ships with no
--> per-(line of business, role type) exceptions, so every pre-existing role takes
--> DEFAULT_BILL_RATE. Do not revisit this value when the card changes — that is the
--> whole point of snapshotting.
-->
--> The column deliberately gets NO default, so a future write path that forgets to
--> snapshot fails loudly rather than silently inventing a price.
ALTER TABLE "project_roles" ADD COLUMN "bill_rate" numeric(12, 2);--> statement-breakpoint
UPDATE "project_roles" SET "bill_rate" = 250;--> statement-breakpoint
ALTER TABLE "project_roles" ALTER COLUMN "bill_rate" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_roles" ADD CONSTRAINT "project_roles_bill_rate_positive" CHECK ("project_roles"."bill_rate" > 0);
