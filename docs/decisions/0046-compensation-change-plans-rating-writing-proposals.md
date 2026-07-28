# 0046 — Compensation change plans: rating-writing proposals that never write compensation

**Status:** accepted · 2026-07-28

## Context

Managers run a compensation round as a cohort exercise: pick a group of people,
decide a rating for each, decide a number for each, hold the conversation, tick
it off. Until now the app supported *half* of that — [ADR 0032](./0032-staff-rating-levels-effective-dated-manager-only.md)
/ [ADR 0042](./0042-per-role-subratings-app-owned-jsonb.md) gave a bulk **level +
subratings** editor, and [ADR 0020](./0020-compensation-effective-dated-import-only.md)
gave read-only compensation. The round itself lived in a spreadsheet.

The obvious feature — "let managers plan and apply compensation changes" — runs
straight into ADR 0020's central decision: **Rippling is the system of record for
pay, and this app has no comp write path at all.** ADR 0020 rejected an in-app comp
editor explicitly, because a second writer invites drift on the most sensitive data
in the system. So the design question was not "how do we write comp" but *"can a
compensation-planning tool be genuinely useful without becoming a second writer?"*

Three further constraints:

1. **The proposal must be durable and reviewable**, not a transient UI state — it
   spans weeks of one-on-ones and is the record of what was decided.
2. **The rating half genuinely belongs in this app** (it already owns `staff_rating`),
   so a plan is not purely advisory: committing it has a real effect.
3. **A committed plan must not silently rot.** If the app proposes a number and
   never applies it, someone has to know whether it actually landed.

## Decision

**A compensation change plan is a named, effective-dated *proposal* over a cohort.
Committing it writes ratings (`staff_rating`) and nothing else. Compensation stays
a proposal — [ADR 0020](./0020-compensation-effective-dated-import-only.md) stands
unamended, and is not superseded.**

### Two tables, both plain (not effective-dated)

`compensation_plan` + `compensation_plan_item` (`src/lib/db/performance-schema.ts`,
migration `drizzle/0009_jittery_wolfsbane.sql`). A plan is a *document*, not a fact
about a person, so the effective-dating pattern of [ADR 0007](./0007-staff-employment-effective-dating.md)
doesn't apply to it; the plan carries **one** `effectiveDate` — the date the ratings
it commits are dated with. Status is a two-value pgEnum (`DRAFT` | `COMMITTED`)
whose tuple lives in the pure `src/lib/performance/compensation-plan.ts`, per the
shared-enum convention of [ADR 0016](./0016-junction-table-and-shared-enum-conventions.md).
An item mirrors `staff_rating`'s rating shape exactly (`level` integer with the same
0–4 `CHECK`, `subratings` jsonb) so commit copies it straight across, and adds the
proposal (`plannedAmount`/`plannedCurrency`), three independent workflow booleans
(rating done / meeting done / complete), and two note fields. Shape detail lives in
[data-model.md](../data-model.md) and [domains/performance.md](../domains/performance.md).

### Commit writes ratings; the comp write is a deliberate, separable hole

`commitCompensationPlan` does exactly two things in one transaction: insert the new
dated `staff_rating` rows, and freeze a compensation snapshot per item. There is
**no employment write, and no partially-built one** — but the action is structured
so that adding one later is a contained change (the rating inserts and the
per-item comp handling are already separate steps over the same
already-loaded `employmentByStaff` map). **Adding an in-app comp write would still
need a new ADR amending 0020** — the seam exists so the decision stays cheap to
revisit, not so it can be slipped in.

The rating write reuses `saveStaffEvaluation`'s hardening verbatim (which is why
`sanitizeSubratings` / `canonicalSubratings` moved into the pure
`src/lib/performance/rating-rubric.ts` — see *Consequences*): re-sanitize subratings
against each person's **current** role, drop no-ops, skip inactive/unknown staff,
and reject an effective date that predates anyone's latest rating (which would file
the new row as history and never become current). `committedAt` is the idempotency
guard: `requireDraftPlan` rejects a second commit, and rejects every item write
against a committed plan.

### The snapshot is the reconciliation half, not a cache

Commit freezes `snapshotAmount` / `snapshotCurrency` / `snapshotEmploymentType` per
item. This is what makes "we don't write comp" workable rather than merely honest:

- A **committed plan shows a stable before/after.** Its "current" column reads the
  snapshot, so the historical record of what was decided doesn't shift as live pay
  changes underneath it.
- A committed plan **flags drift**. The read also returns *live* comp, and the row
  renders **"Applied"** or **"Not applied · $X"** by comparing the two (sub-dollar
  differences are rounding, not drift). A committed plan is a standing instruction
  to whoever operates Rippling, and this is how you see whether it was carried out.

`snapshotEmploymentType` is stored because `plannedAmount` is **one figure whose
meaning depends on employment type** — an annual `base` for `FULL_TIME`, an
`hourlyRate` for `HOURLY` (`currentCompAmount` is the single place that mapping
lives; bonuses are out of scope). Without the type recorded, a years-old snapshot of
someone who has since switched could be misread by two orders of magnitude.

### Access: the conjunction of two existing capabilities, no matrix change

Every plan surface — all three pages (list, editor, plan staff), the nav sub-item,
and every action (three reads + six mutations) — requires
**both** `staff.viewCompensation` **and** `ratings.edit`, expressed once as
`COMPENSATION_PLAN_ACCESS: PermissionCheck` in the pure module. Better Auth's
`authorize` **ANDs across resources** (`node_modules/better-auth/dist/plugins/access/access.mjs`,
`connector = "AND"`), so this is a genuine conjunction: `finance` (comp, no ratings)
is denied; manager/admin remain. **No new capability, no matrix row** — it is a
*request* against the existing matrix, so `permissions.ts` stays the only place
access-control logic lives.

This surface also **deliberately departs from the anonymised-rows discipline** that
`getCompensationSummaryData` / `getRatingsSummaryData` maintain. Those are aggregate
views, where identity would be gratuitous bulk exposure; a comp plan is inherently
per-person and named. Identity-bearing rows are the reason for the stricter gate,
not an exception to it. See [domains/permissions.md](../domains/permissions.md).

## Consequences

- **ADR 0020 is intact.** Rippling is still the only writer of `staff_employment`;
  there is still no comp edit UI. What changed is that the app now *proposes* comp
  and *reconciles* against it.
- **A committed plan is a durable historical record** that keeps working: frozen
  before/after, live drift badge, immutable items. It is also **one-way** — there is
  no un-commit, and no path to edit a committed plan.
- **Commit is partial by design.** Deactivated staff are skipped rather than
  aborting the commit (the rest of the cohort's decisions still land), and unchanged
  items write nothing — most of a large plan legitimately produces no rating rows.
- **Ratings now have a second write path.** `saveStaffEvaluation` (the bulk grid)
  and `commitCompensationPlan` both append to `staff_rating`. Any future change to
  rating-write hardening must be made in the shared pure helpers
  (`sanitizeSubratings` / `canonicalSubratings` in `rating-rubric.ts`), not in one
  action — the extraction exists precisely so the two can't drift.
- **Percentage change is FX-invariant by construction.** `planChangePercent`
  computes from the **native** amounts, not the display-converted ones, so switching
  the CAD/USD/Default toggle re-denominates the money columns but can never move the
  percentage. Cross-currency proposals (a CAD salary moved to USD) convert both legs
  before subtracting. This is pinned by the one new test file (see below).
- **Two tests, as a deliberate exception to [ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md).**
  `src/lib/performance/compensation-plan.test.ts` pins the FX-invariance of the
  percentage and the "every missing/zero input yields `null`, never NaN/Infinity"
  rule. Both are money-correctness invariants the type checker cannot express; this
  is not a return to a broad suite.
- **Autosave, not batch edit.** The editor persists per (row, field) rather than via
  the shared draft-then-confirm `EditableTable`, which forced two extractions — the
  generic `src/hooks/use-autosave-queue.ts` engine and the shared
  `src/components/form/save-indicator.tsx`. See [ui.md](../ui.md).
- **Membership is a separate page and a single set-valued write.** Everything above is
  about *content* — this is the one deliberate split in the *surface*. Who is in the
  round lives on `[planId]/staff`, not in the editor, so the grid stays a pure
  comparison view with no destructive per-row control beside the money columns
  (removing an item cascades away its proposal and notes, and there is no undo). The
  roster submits the **complete checked set** to a single `setCompensationPlanStaff`,
  which diffs server-side and applies inserts + deletes in one transaction — chosen
  over an add/remove action pair (which the first cut had) so that two managers
  reconciling concurrently land a coherent membership rather than interleaving partial
  operations, and so the client never tracks a delta. Existing members are untouched
  by a reconcile. See [domains/performance.md](../domains/performance.md) and
  [ui.md](../ui.md) → *Membership belongs off the grid*.
- **`snapshot*` columns are dead weight on a draft** (null until commit) and the
  editor has to branch on status when choosing a baseline. Accepted: the alternative
  is a second table for three columns written once.

## Alternatives considered

- **Write compensation on commit** (the obvious feature). Rejected: it directly
  reverses [ADR 0020](./0020-compensation-effective-dated-import-only.md)'s
  "Rippling is the system of record" and reintroduces exactly the drift that
  import-only exists to prevent — two writers of pay, with the app's write invisible
  to the HR system. The snapshot + drift badge recovers most of the value (you can
  see what was decided *and* whether it landed) at none of that cost. Revisit only
  with a real bidirectional Rippling integration, and a new ADR.
- **A "pending compensation" row on `staff_employment`** (a future-dated employment
  row marked provisional). Rejected: it makes the proposal indistinguishable from a
  fact at the storage layer — every existing latest-row-per-staff read (profile,
  directory, dashboard, planner) would have to learn to exclude it, and one that
  forgot would show a proposed salary as the real one.
- **Effective-dating the plan items** (ADR 0007's pattern). Rejected: an item is a
  working document that gets edited, not a fact that accretes history. The history
  that matters — the rating — is already effective-dated on `staff_rating`, and the
  comp history stays in `staff_employment` where Rippling puts it.
- **A new `compensationPlans` capability.** Rejected: the surface is exactly the
  intersection of two existing ones. A new row would have to be granted to precisely
  manager+admin — the set the conjunction already yields — while adding a matrix row
  to keep in lockstep across three files for no new distinction.
- **Reusing the aggregate dashboard's anonymised-row discipline.** Not possible: a
  plan names people by definition. The response was to raise the gate rather than
  pretend the rows could be identity-free.
- **Building the editor on the shared `EditableTable`.** Rejected on two grounds —
  it is a draft-then-confirm *batch* engine (floating save bar + diff dialog), which
  is the opposite of save-on-edit; and it renders exactly one `<tr>` per row, so
  there is nowhere to put an expanded panel. See [ui.md](../ui.md) → *Expandable
  rows*.
