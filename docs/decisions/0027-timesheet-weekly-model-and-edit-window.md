# 0027 — Timesheets: per-day weekly model, whole-week replace, and the ±1-week edit window

**Status:** accepted · 2026-07-13

## Context

The Timesheets domain (v1) needed a concrete shape for the entities the spine only
sketched ("TimeEntry aggregated into Timesheets for approval"). Several choices were
non-obvious and worth pinning so future work doesn't relitigate them:

1. What is the unit of capture and the grain of a TimeEntry?
2. How are edits persisted for a grid the user fills a whole week at a time?
3. Who may edit which weeks — the ownership boundary?
4. Can people log against projects they aren't allocated to?
5. How does the timesheet PTO bucket relate to the existing `staff_pto` table?

## Decision

**A `timesheet` is one person's week; `time_entries` are per-day rows.** The week is
keyed by its **ISO-Monday** `weekStartDate` (`date`), with a `draft → submitted`
lifecycle (`unique(staffId, weekStartDate)`). Each `time_entry` is hours on **one
day** against **exactly one** target — either a `project` (billable) or a non-billable
`category` bucket (`PTO` / `UNALLOCATED_BENCH` / `INTERNAL_ADMIN`). The one-target
rule is enforced by a DB `CHECK` (XOR on `IS NOT NULL`) *and* a zod refine. Week math
lives in a pure, client-importable module (`src/lib/timesheets/timesheet-week.ts`); category
values in another (`src/lib/timesheets/timesheet-category.ts`), mirroring `line-of-business.ts`.

**Saving is a whole-week transactional replace.** `saveTimesheet` creates the
`timesheets` row lazily on first save, then deletes all of its `time_entries` and
re-inserts the non-zero rows in one transaction. The grid is edited a week at a time,
so delete-all + insert is the simplest correct model — no per-row diffing, no stale
rows.

**The 8h/day cap is a per-day total across all rows**, not per project — enforced in
the shared `saveTimesheet.schema.ts` (client resolver + server).

**Timesheets capture weekday (Mon–Fri) work only.** A week is still keyed and displayed
as 7 days, but Saturday/Sunday are non-editable: the grid renders them blank/muted with
no input, and the shared schema rejects any weekend-dated entry (`isWeekend` in
`src/lib/timesheets/timesheet-week.ts`). Weekend work is rare enough for a consultancy that the
simpler, honest default is to disallow it rather than model it.

**Adding a project row autofills weekday cells; non-billable buckets don't.** As a
client-side convenience, adding a project prefills each weekday with its remaining
capacity (8h minus what's already logged that day, weekends skipped) so a main project
soaks up unallocated time; adding a PTO / Unallocated Bench / Internal Admin bucket
starts empty. Prefilled values are ordinary editable cells — this is UX sugar, not a
persistence rule.

**Submit locks; reopen unlocks; no manager approval in v1.** Submitting flips the week
to `submitted` and stamps `submittedAt`; a locked week can't be overwritten by a normal
save. The owner **reopens** (back to `draft`) to correct. There is no approve/reject
step, and no approval granularity question to answer yet.

**Ownership boundary = own record AND a ±1-week edit window.** A normal user may
edit/submit/reopen only their own linked staff record's timesheet, and only for last /
this / next week (`isWithinEditWindow`). The new **`timesheets.edit`** capability
(manager + admin) bypasses **both** the owner check and the window. Enforced by the
`authorizeTimesheetEdit` `ActionAuthorize` hook + `canEditTimesheet` (mirrors
`canEditStaff`, plus the window).

**Logging is allowed against any project** (not only allocated ones), plus the three
non-billable buckets. **The timesheet PTO bucket is independent of `staff_pto`** — no
sync in v1.

## Consequences

- Reconstructing "what did this week look like before the last edit" is impossible —
  the replace discards prior rows (acceptable; timesheets aren't effective-dated
  history, unlike `staff_employment`).
- The ±1-week window keeps normal users honest about logging promptly while letting
  managers/admins fix any week — a self-service correction path without an approval
  bureaucracy.
- `restrict` on `time_entries.projectId` means a project with logged time can't be
  deleted — deliberate, so actuals aren't silently orphaned.
- Because logging isn't restricted to allocations, the eventual actuals-vs-plan
  reconciliation must tolerate entries against projects a person was never allocated to.
- Independent PTO bucket means PTO can be double-recorded (Rippling leave + a timesheet
  row); reconciling the two is left open.

## Alternatives considered

- **Per-entry incremental writes** (insert/update/delete individual rows) — rejected:
  more moving parts for a form that is naturally a whole-week snapshot; the transactional
  replace is trivially correct.
- **Per-project daily cap** — rejected: the real constraint is a person's day, not any
  one project; a total cap matches how hours are actually bounded.
- **A manager approval workflow in v1** — deferred: submit-locks-the-week covers the
  "done, don't touch" need without building review UI, states, and an audit trail yet.
- **Restricting logging to allocated projects** — rejected for v1: allocations
  (`project_roles`) are an early, non-authoritative cut; gating time capture on them
  would block legitimate logging. Revisit if/when allocation becomes the source of truth.
- **Syncing the PTO bucket with `staff_pto`** — deferred: the two are populated by
  different actors (self-logged vs. Rippling import) and reconciling them is its own
  design problem.
