# 0026 — Staff "reports to": durable self-FK, import-resolved by email in two passes

**Status:** accepted · 2026-07-13

## Context

Staff needed a "who does this person report to" relationship ([design spec](../plans/2026-07-13-staff-manager-design.md)).
A person has at most one manager, and the manager is another `staff` record. Two
design questions had non-obvious answers: **where the relationship lives** (durable
`staff` identity vs effective-dated `staff_employment`), and **how the CSV import
resolves it**, given that the source names the manager by *email* while the importer
matches people by `ripplingId` and create-ids don't exist until commit.

The relationship is populated **exclusively by the staff CSV import** (a new
`Manager - Work email` column) and shown **read-only** on the profile. There is no
in-app editor — the import is the sole writer, so re-imports never fight a manual edit.
It mirrors the `contacts.managerId` self-FK ([ADR 0022](./0022-contact-manager-self-reference.md)).

## Decision

### 1. Durable self-FK on `staff`, not effective-dated on `staff_employment`

`managerId` is a nullable, self-referential FK `text().references((): AnyPgColumn => staff.id, { onDelete: "set null" })`
on the **`staff`** table (`src/lib/db/staff-schema.ts`), migration `drizzle/0025_giant_bullseye.sql`.
Drizzle needs the `AnyPgColumn` return annotation to type the self-reference, same as
`contacts.managerId`. `set null` matches the optional-FK convention: removing a manager
clears their reports' pointers rather than deleting or blocking.

We treat "reports to" as a **durable identity fact** — a property of the person right
now — deliberately **not** history-as-rows like role/billability/compensation
([ADR 0007](./0007-staff-employment-effective-dating.md)). The import is authoritative
and the field is display-only, so there's no demand to reconstruct "who was your
manager on date X"; adding it to `staff_employment` would mean carrying it forward on
every effective-dated write (like `isManagement`/`billableType`/comp) for a value
nobody queries as-of. Keeping it on `staff` keeps the read a plain self-join and the
write a single `set` clause on the existing `staff` upsert. If reporting-line *history*
ever becomes a need, that's the trigger to revisit — same open-question shape as
external charge rates.

### 2. Import resolves email → `ripplingId` → `staff.id` in two passes

The manager is matched by **email**, but people are matched by `ripplingId` and
`email` is **not unique** on `staff`. So the manager is carried through the pipeline as
a **stable manager `ripplingId` reference**, resolved to a concrete `staff.id` only at
commit (when create-ids exist):

- **`transform.ts`** extracts `managerEmail` (trim/lower, blank → null) onto `NormalizedStaff`.
- **`plan.ts`** builds an `email → ripplingId(s)` index from **the incoming batch
  first, then the DB** — the batch covers a full-org or first import (manager is a
  create in the same file), the DB lookup covers a partial import (manager lives only
  in the DB). It resolves each row via the pure `managers.ts` (`resolveManager`),
  loads each matched person's *current* manager as a ripplingId so a manager-only
  change is detectable, and includes the manager in the diff — **a manager-only change
  counts as an update**, tracked as its own `managerChanged` flag rather than in the
  `ComparableField` tuples (the compared value is a resolved ripplingId, not the raw
  email).
- **`commitStaffImport.ts`** builds `ripplingId → staffId` across this batch's creates
  (freshly minted ids) + updates + a DB lookup for managers only in the DB, then sets
  `managerId` through the **same `staff` upsert's `set` clause** (`managerId: sql\`excluded.manager_id\``)
  — no new write path. Because creates and updates share **one** batched
  `insert(staff)` statement, Postgres verifies the self-FK at statement end, so an
  **intra-batch reference (A managed by B, both new in the same file) resolves fine**
  (verified against Postgres).

**Re-sync rule — blank clears; unresolvable or column-absent preserve.** The pipeline
distinguishes three states, so a re-sync can't silently lose a correct reporting line
(this is the correction to the original design, which cleared the manager on *any*
non-resolving cell and treated an absent column as "everyone blank"):

- **column present + cell resolves** → set/update the manager;
- **column present + cell blank** (`managerEmail === null`) → **clear** the manager
  (`managerId = null`) — the sole case that wipes a link, and it's authoritative;
- **column present + cell filled but unresolvable** (a warning case, see below) →
  **preserve** the existing person's current manager (warn only). A typo, an ambiguous
  email, or a self-reference must not wipe a link that was correct.
- **column entirely absent from the CSV** (`managerEmail === undefined`) → the import
  carries **no** manager info, so **all** existing links are preserved and resolution
  isn't attempted. (The original design read an absent column as blank-for-everyone,
  which would have wiped every manager on a comp-only or partial re-sync — a data-loss
  bug caught in review.)

`transform.ts` sets `managerEmail` to `undefined` when the column is absent vs `null`
for a present-but-blank cell (the zod field is `.nullish()`); `plan.ts` branches on
those three states per existing person. A **brand-new** person has nothing to preserve,
so blank *or* unresolvable simply leaves the link unset.

**Flagging is non-blocking.** Three cases surface as `managerWarnings` (the person still
imports): email matches no staff (`not_found`), matches >1 staff (`ambiguous`), or the
row names its own email / resolves to self (`self`). This is distinct from a `SkippedRow`
— the row is *not* skipped, and (per above) an existing person's manager is left intact.
The warning message states **only the problem** (e.g. `Manager email "x@y" matched no
staff.`) because what happens to the link differs by case; the import UI's "Manager
issues" section explains existing links are left unchanged and a blank cell clears.

**`managersLinked`** (commit result / success toast) counts only relationships **actually
established or changed** this import — creates that got a manager, plus updates whose
manager changed to a non-null value. A cleared link or an unchanged pointer riding along
an unrelated field change doesn't count.

**No cycle detection beyond self-reference** — intentional for a display-only field
(`contacts.managerId` doesn't guard cycles either).

## Consequences

- **Import-only, no editor.** `managerId` can only be set/changed/cleared by re-running
  the staff import. There is no profile or bulk-edit affordance; building one would need
  to respect the same email-authoritative model or take ownership away from the import.
- **A link is only ever lost on purpose.** The one path that clears a manager is a
  present-but-blank cell; every other outcome (unresolvable cell, absent column)
  preserves the existing pointer. So a routine or partial re-sync (e.g. comp-only, or a
  file that omits the manager column) is safe.
- **Display is a plain self-join.** `getStaffProfile` aliases `staff` and left-joins on
  `managerId` to project `{ managerId, managerName }`; `profile-view.tsx` shows a
  "Reports to <link>" line. No "direct reports" (inverse) view exists yet.
- **Manager deleted later → pointer clears** via `onDelete: set null` (a leaver is
  normally marked inactive, not deleted — see [ADR 0007](./0007-staff-employment-effective-dating.md)
  — so this mainly bites hard deletes).
- **Two extra plan-time queries** when manager emails are present (DB email candidates;
  current-manager ripplingIds), plus one commit-time lookup for external managers. Fine
  at company scale.

## Alternatives considered

- **Effective-dated on `staff_employment`.** Rejected — see Decision §1: no as-of query
  demand for a display-only, import-authoritative field; would add carry-forward burden.
- **Store the manager's email directly / resolve at read time.** Rejected: `email` is
  non-unique on `staff`, so a stored email can't be a reliable key; resolving to a
  `staff.id` FK once at write time is cleaner and lets the profile self-join.
- **Block the import row on an unresolved manager.** Rejected: the manager link is
  secondary to the person's identity/employment; a bad manager cell shouldn't stop the
  person importing. Surfaced as a non-blocking warning instead (contrast the PTO
  importer's `unresolved` bucket, [ADR 0009](./0009-pto-import-cancel-as-delete.md),
  where a missing staff FK genuinely can't insert).
- **Clear the manager on any non-resolving cell (the original design).** Rejected after
  a code review found it silently wiped correct reporting lines: a single typo, an
  ambiguous email, or an absent manager column would null out an existing link. Now only
  a deliberately blank cell clears; unresolvable and column-absent preserve. This makes
  "blank" the sole authoritative clear and keeps partial/comp-only re-syncs non-destructive.
- **Carry the manager as a resolved `staff.id` through the plan.** Rejected: create-ids
  don't exist until commit, so a ripplingId is the only stable cross-batch reference; the
  single-statement batched insert is what makes intra-batch self-FKs resolve.
