# Domain: Timesheets

**Status: built (v1).** Weekly time capture — the *actuals* that complement the
allocation plan. Approval workflow and billing are deliberately out of v1 scope
(see [Open questions](#open-questions)).

## Purpose

Record what People actually worked on, week by week, so we can eventually bill
clients, measure utilization, and compare actuals to the allocation plan. v1
delivers the capture + draft→submitted lifecycle; downstream (approval, billing,
reconciliation) is not built yet.

## Data model — as realized

Schema slice `src/lib/db/timesheets-schema.ts` (barrelled by `src/lib/db/schema.ts`;
migration `drizzle/0026_rich_the_captain.sql`). See [ADR 0027](../decisions/0027-timesheet-weekly-model-and-edit-window.md).

- **`timesheets`** — one person's week. `id` (prefix `ts`), `staffId` → `staff.id`
  (cascade), **`weekStartDate`** (`date`, the ISO **Monday** of the week), `status`
  (`timesheet_status` enum: `draft` | `submitted`, default `draft`), `submittedAt`
  (nullable timestamp — stamped on submit, cleared on reopen), timestamps.
  **`unique(staffId, weekStartDate)`** (one sheet per person per week) + index on
  `staffId`. The row is created **lazily** on first save/submit — an unsaved week
  is just an empty draft, not a row.
- **`time_entries`** — the per-day rows. `id` (prefix `te`), `timesheetId` →
  `timesheets.id` (cascade), `date` (`date`, one of the parent week's 7 days),
  **`projectId`** → `projects.id` (`restrict`, nullable), **`category`**
  (`time_entry_category` enum, nullable), `hours` (`numeric(4,2)`, e.g. `7.5`).
  Index on `timesheetId`. A row targets **exactly one** of project *or* category —
  a DB `CHECK` (`time_entries_target_check`, XOR on `IS NOT NULL`) plus a zod refine
  enforce it. `restrict` on `projectId`: a project with logged time can't be deleted.
- **`time_entry_category`** — the non-billable buckets: `PTO`, `UNALLOCATED_BENCH`,
  `INTERNAL_ADMIN`. Values + labels live in the pure, client-importable module
  `src/lib/timesheet-category.ts` (the single source feeding the pgEnum, zod, and the
  form labels — same pattern as `src/lib/line-of-business.ts`). The **PTO bucket is
  independent of the `staff_pto` table** — no sync between the two in v1.

**Week math** lives in the pure module `src/lib/timesheet-week.ts` (no `db` import,
so UI + actions + validation agree on what a "week" is): `getWeekStart`, `addWeeks`,
`getWeekDays`, `currentWeekStart`, `weeksBetween`, `isWithinEditWindow`, `isWeekend`.
Weeks are timezone-agnostic and keyed by their ISO-Monday `"YYYY-MM-DD"` string
(matching the DB's `date` convention); it deliberately parses/formats via local Y/M/D
parts to avoid `new Date("...")` UTC drift.

**Weekday-only capture.** Although a week spans all 7 days, timesheets record
**weekday (Mon–Fri) work only**. `isWeekend(date)` gates this on both sides: the grid
renders Sat/Sun columns blank and muted with no input, and `saveTimesheet.schema.ts`
rejects any entry whose date is a weekend ("Hours can't be logged on weekends.").

## Key flows

Actions live in `src/actions/timesheets/`. All three mutations use
`secureActionClient` gated by the `authorizeTimesheetEdit` hook (see [Access](#access-control)).

The UX is **browse, then edit** — there is no week-arrow navigation.

- **Browse.** `/timesheets` (`src/app/(app)/timesheets/page.tsx`) is a **list of the
  viewer's own weeks, newest first** (`src/components/timesheets/timesheets-list.tsx`).
  Each row shows the week range, status (Draft / Submitted, or **"Not started"** for a
  week with no row yet), the total hours, and an **Edit** / **View** button (View when
  the week is outside the editable window). `getTimesheetList(staffId)` is the aggregate
  read: every week with a `timesheets` row (summed hours), plus the previous / current /
  next weeks always injected even when unstarted, so the actionable ±1-week window is
  never missing from the list.
- **Log → save draft.** Clicking Edit/View opens **`/timesheets/[week]`**
  (`src/app/(app)/timesheets/[week]/page.tsx`) — the weekly grid
  (`src/components/timesheets/timesheet-week.tsx`): one row per target (project or
  bucket), a hours cell per **weekday**, per-day column totals with a cap warning. The
  status badge + week range live in the edit-page header; the grid itself carries no
  navigation. The `[week]` param is any date in the target week, normalized to its
  ISO-Monday key. **`saveTimesheet`** does a **whole-week transactional replace**:
  create the `timesheets` row lazily if absent, then delete all its `time_entries` and
  re-insert the non-zero rows. Zero-hour rows (empty cells) are dropped. Validation
  (`saveTimesheet.schema.ts`, shared client+server): one target per row, dates within
  the week, no weekend dates, no duplicate (day, target) rows, and the 8h/day cap.
- **Project autofill.** Adding a **project** row prefills its weekday cells with each
  day's *remaining* capacity (8h minus hours already logged that day) — a convenience so
  a main project soaks up unallocated weekday time. Weekends are skipped. Adding a
  **non-billable** bucket (PTO / Unallocated Bench / Internal Admin) does **not**
  autofill — it starts empty. This is client-only sugar in the grid; the values are
  still editable and saved like any other.
- **Submit → lock.** **`submitTimesheet`** flips `draft → submitted` and stamps
  `submittedAt` (upsert on the unique key, so an empty week can be submitted).
  A submitted week is **locked**: `saveTimesheet` refuses to overwrite it unless the
  caller holds `timesheets.edit`.
- **Reopen.** **`reopenTimesheet`** flips `submitted → draft` and clears `submittedAt`,
  letting the owner edit again (within their window; capability-holders anywhere).
- **Read.** `getTimesheet(staffId, weekStartDate)` (server-only) returns the week with
  entries joined to project + company names; self-scoped (another person's requires
  `timesheets.edit`, else `null`). `getSelectableProjects` lists every project (+ its
  company) for the row picker.

### The 8h/day cap

The ceiling is **8 hours total across all rows for a single day** (not per project) —
`DAILY_HOUR_CAP` in `saveTimesheet.schema.ts`, enforced in the shared zod schema (so
the grid warns live and the server rejects). A single entry also can't exceed 8h.

## Access control

- **Capability:** **`timesheets.edit`** (manager + admin) — edit *any* timesheet,
  bypassing both the owner check **and** the edit window.
- **Owner + window (no permission):** a normal user may edit/submit/reopen only their
  **own** linked staff record's timesheet, and only for a week **within ±1 week of the
  current week** (last / this / next week — `isWithinEditWindow`). Outside that window,
  editing their own past/future weeks requires `timesheets.edit`.
- The single decision point is **`canEditTimesheet`** + the **`authorizeTimesheetEdit`**
  `ActionAuthorize` hook in `src/actions/timesheets/canEditTimesheet.ts` (mirrors
  `canEditStaff`, plus the time window). The capability short-circuits before the DB;
  otherwise the window is checked, then ownership by resolving the caller's own `staff`
  row. `canEditTimesheet` also drives the page as a UI affordance (render inputs only
  when true); the hook is the real boundary. See [permissions](permissions.md).

## Connects to

- **Projects / CRM** — every billable row targets a `project` (which belongs to a
  CRM `company`); logging is allowed against **any** project, not only allocated ones.
  Entries will eventually roll up to the project (and its company) for billing.
- **Allocations** — `time_entries` are the **actuals** that reconcile against the
  **plan** (`project_roles`). No reconciliation is built yet.
- **Staff** — a timesheet belongs to a `staff` record (via `staffId`); the current
  user resolves to it via `staff.userId`.
- **Performance** — billable vs. available hours = utilization (future).

## Open questions

Resolved in v1 (recorded here so they aren't relitigated — see [ADR 0027](../decisions/0027-timesheet-weekly-model-and-edit-window.md)):

- **Can people log against projects they aren't allocated to?** **Yes** — any project
  is a valid target, plus the three non-billable buckets.
- **Approval granularity?** **Deferred — no manager approval in v1.** Submit merely
  locks the week; there is no approve/reject step or per-entry/per-project approval.
- **Lock / correction policy?** Submit locks the week; the owner **reopens** it (within
  their window) to correct, and `timesheets.edit` holders can edit a locked week in
  place. No audit trail on corrections yet.

Still genuinely open:

- **Billing** — charge rates, billable-vs-non-billable margin, invoice generation.
- **Approval workflow** — if/when a manager sign-off step is added (approve/reject,
  audit trail, per-scope granularity).
- **Allocation reconciliation** — surfacing actuals vs. the `project_roles` plan.
- **Utilization reporting** — billable ÷ available hours over a period.
- **PTO ↔ `staff_pto` sync** — the timesheet PTO bucket is independent today; whether
  logged PTO should reconcile with imported Rippling leave is unresolved.
</content>
</invoke>
