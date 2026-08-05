ALTER TABLE "opportunities" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
CREATE INDEX "opportunities_status_closed_at_idx" ON "opportunities" USING btree ("status","closed_at");--> statement-breakpoint
--> `closed_at` is the instant a deal was DECIDED. Drizzle generated the ADD COLUMN, the
--> index and the shape CHECK; the backfill below is HAND-ADDED and must run BETWEEN the
--> ADD COLUMN and the CHECK, or the constraint rejects every existing closed row. Same
--> shape as 0025_empty_frank_castle.sql.
-->
--> The backfill is a ONE-TIME APPROXIMATION, not policy. Rows closed before this column
--> existed have no recorded close instant, so they take `updated_at`: the last time the
--> row was touched, which for a decided deal is *usually* — never provably — the close.
--> Deliberately not `created_at` (that would file every historical win in the week its
--> deal was opened) and deliberately not left NULL (the CHECK requires a value, and a
--> NULL would make "won this month" silently undercount instead of visibly approximate).
-->
--> Accepted consequence: for roughly one month after this migration, a handful of
--> long-closed deals whose rows happen to have been touched recently will appear in the
--> home dashboard's "closed this week/month" figures. Self-healing. Do not re-run or
--> "correct" this statement — from here on the column is maintained by the status
--> writers via `closedAtFor` (src/lib/crm/opportunity-close.ts). See docs/decisions/0069.
UPDATE "opportunities" SET "closed_at" = "updated_at" WHERE "status" IN ('closed_won', 'closed_lost');--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_closed_at_shape" CHECK (("opportunities"."status" in ('closed_won', 'closed_lost')) = ("opportunities"."closed_at" is not null));
