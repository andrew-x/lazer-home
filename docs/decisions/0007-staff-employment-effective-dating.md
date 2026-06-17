# 0007 — Split staff into durable identity + effective-dated employment

**Status:** accepted · 2026-06-15

## Context

The Staff profiles domain needed its first real schema. A person has two kinds of facts: ones that don't change (name, email, profile links, join date) and ones that change over their tenure (role, line of business, billability, utilization target). The PSA spine depends on knowing those changing facts *as of a date* — allocations, billing, and utilization reports all need "what was this person's role/target when they logged this time," not just "today."

## Decision

Two tables (`src/lib/db/schema.ts`):

- **`staff`** — the durable person record. Identity, profile links, lifecycle (`joinDate`, `terminationDate`, `isActive`).
- **`staff_employment`** — the time-varying facts, stored as **history-as-rows**: one row per change, each with a notNull `effectiveFromDate`. The **current state is the row with the latest `effectiveFromDate`** (for an as-of read, the latest row with `effectiveFromDate <= the date`). Changing someone's role means *inserting a new row*, never updating in place. FK `staffId` → `staff.id` with `onDelete: cascade`.

The external Rippling HR id (`ripplingId`) lives on **`staff`** (notNull, unique) — the durable record is what reconciles 1:1 with a Rippling employee, and it's the match key for the staff CSV import (see [0008](./0008-localhost-only-admin-area.md)).

Employment facts are typed with Postgres enums (`line_of_business`, `role`, `employment_type`, `billable_type`).

### Leavers and rejoiners (2026-06-15)

A `staff` row models **one engagement/tenure, not a permanent human identity.** When a person leaves, we do **not** reuse or later reactivate their record:

- The departing `staff` row is marked **inactive** — `isActive = false` with `terminationDate` set. It and its employment/PTO history are kept as-is for historical reads.
- A rehire gets a **brand-new `staff` row** — new id, fresh `joinDate`, its own `staff_employment` history starting over.

So a single human can map to **multiple `staff` rows over time** (one per stint). There is **no cross-tenure "person" entity** linking them today; `staff.userId` (one auth account) doesn't bridge stints either, since a returning person may sign in under the same user but land on a new staff row. Anything that must follow a human across stints — tenure-spanning reporting, "have we worked with them before," merging review history — has to gather multiple staff rows itself. **Known limitation:** if cross-tenure continuity becomes a real need, introduce a `person` entity that staff rows point to, rather than reactivating old rows.

`utilizationTarget` is an integer percent (0–100), defaulting to 100; **callers set it to 0 when `isBillable` is false** — the coupling is a convention, not a DB constraint.

### In-place correction (bulk edit, 2026-06-17)

The original rule — *every change inserts a new row* — assumes each write is a **real, dated change**. But not every write is: sometimes the latest row is just **wrong** (a typo, a bad import derivation) and inserting a new row would pollute the history with a fake "change" on a fake date. So the bulk employment editor (`/admin/bulk-edit-roles`, `commitBulkEditEmployment`) splits on whether the admin supplies an effective date:

- **No effective date → UPDATE the staff's latest employment row in place.** Semantics: *correcting* the current fact, not recording a new one. No new historical row; `updatedAt` bumps.
- **An effective date → INSERT a new effective-dated row** (the original behaviour). Semantics: a genuine change effective on that date. The date must be **strictly after** the staff's latest `effectiveFromDate` (re-validated server-side), so the "latest wins" invariant still holds and history stays ordered.

This is a **deliberate, narrow extension** of the decision, not a reversal: the insert-only path remains the default for real changes (and the staff import still only inserts). In-place mutation is confined to this admin correction tool. **Gotcha:** an in-place correction silently rewrites what reports will reconstruct as the current fact's whole validity span — that's the point (it was never true), but it means bulk-edit is *not* an audit-safe way to record a real change; use an effective date for those.

## Consequences

- Full employment history is preserved for free; reports can reconstruct any past state. This is the canonical effective-dating pattern for the project — rates/cost are expected to follow it.
- Every read of "current" employment must order by `effectiveFromDate desc` and take the first row (with a `<= asOf` filter for historical reads). A naive 1:1 join will be wrong.
- `isBillable` / `utilizationTarget` consistency is unenforced; a bad caller can write a billable=false row with target 100. Validate in the action layer.
- `billableType` is NOT NULL with default `HUB` (since `drizzle/0010`; earlier nulls were backfilled). It's set in-app only and carried forward by the import — there's no "no billable type" state.
- **`staff` is a tenure, not a person.** A rehire is a new row, not a reactivation; one human can have several staff rows. No entity links them yet — cross-stint lookups must aggregate manually (see *Leavers and rejoiners* above).
- **Identity linkage resolved:** `staff` now has a nullable, unique `userId` FK to the auth `user` (`onDelete: set null`) — null until first sign-in, since staff are synced by email beforehand. Login resolves user → staff via `getCurrentStaff` and auto-links by email on first login (see [0006](./0006-google-only-auth-and-layout-gating.md) and [domains/staff-profiles.md](../domains/staff-profiles.md)). (The earlier `staff_profile` example that was 1:1 with `user` was deleted, so there's no overlap debt.)
- **Not every staff sub-table is effective-dated.** `staff_pto` (added later, `drizzle/0002_loud_texas_twister.sql`) is a sibling FK'd to `staff`, but it stores discrete leave spans (`startDate`/`endDate`, `type`, `isPending`), *not* history-as-rows — there's no "current row" to resolve. Reach for effective-dating only when you need an as-of-date answer about a single evolving value; a set of independent dated events is just rows.

## Alternatives considered

- **Flat columns on one `staff` table** — rejected: loses history and forces destructive updates; can't answer as-of-date questions that allocations/billing need.
- **Generic temporal range (`validFrom`/`validTo`) per row** — rejected for now as heavier; a single `effectiveFromDate` with "latest wins" is simpler and sufficient since employment facts don't overlap.
- **Audit-log/event table separate from current state** — rejected: a second source of truth to keep in sync; history-as-rows keeps current and past in one place.
