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

Schema slice `src/lib/db/timesheets-schema.ts` (barrelled by `src/lib/db/schema.ts`; the
drizzle history has been squashed into a single baseline `drizzle/0000_lethal_rictor.sql`,
so read the schema file for the definitive shape rather than a per-feature migration). See [ADR 0027](../decisions/0027-timesheet-weekly-model-and-edit-window.md).

- **`timesheets`** — one person's week. `id` (prefix `ts`), `staffId` → `staff.id`
  (cascade), **`weekStartDate`** (`date`, the ISO **Monday** of the week), `status`
  (`timesheet_status` enum: `draft` | `submitted`, default `draft` — the pgEnum is
  **built from** the pure client-safe `src/lib/timesheets/timesheet-status.ts` tuple/labels, one
  source for the enum, read types, and UI, like `timesheet-category.ts`), `submittedAt`
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
  `src/lib/timesheets/timesheet-category.ts` (the single source feeding the pgEnum, zod, and the
  form labels — same pattern as `src/lib/crm/line-of-business.ts`). The **PTO bucket is
  independent of the `staff_pto` table** — no sync between the two in v1. The one exception
  is the *"Fill in PTO"* prefill (see [Adding rows & prefill](#adding-rows--prefill)), which
  **reads** `staff_pto` one-way to seed hours; it is a convenience, not a two-way link.

**Week math** lives in the pure module `src/lib/timesheets/timesheet-week.ts` (no `db` import,
so UI + actions + validation agree on what a "week" is): `getWeekStart`, `addWeeks`,
`getWeekDays`, `currentWeekStart`, `weeksBetween`, `isWithinEditWindow`, `isWeekend`,
`weekdayIndex`, and `formatWeekRange` (the one week-label formatter, shared by the browse
table and the reminder banner). A second pure module,
`src/lib/timesheets/timesheet-alerts.ts` (tested in `timesheet-alerts.test.ts`), derives the
**submission reminders** from those weeks — see [Submission reminders](#submission-reminders).
Weeks are timezone-agnostic and keyed by their ISO-Monday `"YYYY-MM-DD"` string
(matching the DB's `date` convention); it deliberately parses/formats via local Y/M/D
parts to avoid `new Date("...")` UTC drift.

**Weekends are enterable but flagged for review.** A week spans all 7 days and hours
can be logged on **any** of them. Weekend (Sat/Sun) cells render fully-editable inputs —
they keep a muted `bg-muted/40` shading as a visual hint that weekend work is unusual,
but nothing blocks it. `saveTimesheet.schema.ts` does **not** reject weekend dates; any
weekend hours instead trip the same **soft review warning** as an over-8h day or an
over-40h week (see [Hour thresholds](#hour-thresholds--weekend-hours--soft-warnings-not-hard-caps)).
`isWeekend(date)` (from the week-math module) drives that flagging + the muted shading —
not a gate. **Autofill/prefill still only fill weekdays** — weekend hours are manual
entry only.

## Key flows

Actions live in `src/actions/timesheets/`. All three mutations use
`secureActionClient` gated by the `authorizeTimesheetEdit` hook (see [Access](#access-control)).

The UX is **browse, then edit** — there is no week-arrow navigation.

- **Browse.** `/timesheets` (`src/app/(app)/timesheets/page.tsx`) is a **list of the
  viewer's own weeks, newest first** (`src/components/timesheets/timesheets-list.tsx`).
  Each row shows the week range, status (Draft / Submitted, or **"Not started"** for a
  week with no row yet), the week's hours **broken into `Project` / `PTO` /
  `Non-billable` / `Total`**, and an **Edit** / **View** button (View when the week is
  outside the editable window). The three buckets **partition** the week, so they sum to
  Total: project = billable (`projectId is not null`), PTO = the `PTO` category broken out
  on its own, non-billable = the remaining categories (bench + internal admin).
  `getTimesheetList(staffId)` is the aggregate read: every week with a `timesheets` row
  (one grouped select with a conditional `sum` per bucket), plus the previous / current /
  next weeks always injected even when unstarted, so the actionable ±1-week window is
  never missing from the list.
- **Log → save draft.** Clicking Edit/View opens **`/timesheets/[week]`**
  (`src/app/(app)/timesheets/[week]/page.tsx`) — the weekly grid
  (`src/components/timesheets/timesheet-week.tsx`): one row per target (project or
  bucket), an hours cell per **day** (weekends editable but muted-and-flagged), per-day
  column totals with an over-standard-hours / weekend warning (see
  [Hour thresholds](#hour-thresholds--weekend-hours--soft-warnings-not-hard-caps)). The
  grid's pure row math — grouping entries into rows, the capacity autofill/prefill, and
  the save payload — lives in `src/lib/timesheets/timesheet-grid.ts`, extracted from the
  component so it stays independent of rendering; the per-day / per-row / week **sums**
  are derived inline in the component from those rows. The
  status badge + week range live in the edit-page header; the grid itself carries no
  navigation. The `[week]` param is any date in the target week, normalized to its
  ISO-Monday key. **`saveTimesheet`** does a **whole-week transactional replace**:
  create the `timesheets` row lazily if absent, then delete all its `time_entries` and
  re-insert the non-zero rows. Zero-hour rows (empty cells) are dropped. Validation
  (`saveTimesheet.schema.ts`, shared client+server): one target per row, the week keyed
  by its ISO Monday, dates within the week, no duplicate (day, target) rows, and a single
  entry ≤ 24h (`MAX_ENTRY_HOURS`). There is **no** daily/weekly total cap and **no weekend
  rejection** — over-standard-hours *and* weekend hours are soft warnings, not rejections
  (see [Hour thresholds](#hour-thresholds--weekend-hours--soft-warnings-not-hard-caps)).
  When the sheet is an editable draft, a **toolbar sits above the grid** ("Add project"
  dialog + the two prefill buttons); `Save draft` / `Submit` / `Reopen` stay in the
  actions row **below** the grid.

### Adding rows & prefill

All row-adding and prefill is **client-side grid sugar** — nothing is written until
`saveTimesheet`; every filled value stays editable. The pure helpers live in
`src/lib/timesheets/timesheet-grid.ts` (client-importable, no `db`), unit-tested in
`timesheet-grid.test.ts`.

- **Add a row — the "Add project" dialog** (`src/components/timesheets/add-project-dialog.tsx`,
  replacing the old inline `Select`). A searchable Dialog with three groups: **"Allocated
  to you"** (this week's allocations, surfaced first as suggestions), **"All projects"**
  (client-side filtered — any project stays loggable), and **"Non-billable"** (the
  `TIMESHEET_CATEGORY` buckets). It reuses the `PROJECT_PREFIX`/`CATEGORY_PREFIX`
  value-namespacing and hands the chosen value to `addTarget`.
- **Adding a project autofills; buckets don't.** Adding a **project** row prefills its
  weekday cells with each day's *remaining* capacity (8h minus hours already logged that
  day, weekends skipped) — so a main project soaks up unallocated time
  (`autofillProjectHours`). Adding a **non-billable** bucket starts empty.
- **Manual "Fill in …" buttons.** Two opt-in buttons above the grid — **"Fill in
  allocations"** and **"Fill in PTO"** — seed cells from `getTimesheetPrefill` (below).
  They are **manual, not auto-fill on load**, and disabled with an explanatory tooltip
  when there's nothing to fill that week. Both go through `applyAllocationFill` /
  `applyPtoFill`, which **only fill currently-empty weekday cells** (never clobber
  user-entered hours) and respect the 8h/day cap across the other rows. `applyAllocationFill`
  upserts a row per allocated project; `applyPtoFill` upserts the PTO category row.
- **Submit → lock.** **`submitTimesheet`** flips `draft → submitted` and stamps
  `submittedAt` (upsert on the unique key, so an empty week can be submitted — for hourly
  staff). A submitted week is **locked**: `saveTimesheet` refuses to overwrite it unless
  the caller holds `timesheets.edit`. For **full-time** staff the action first enforces
  the **40h floor** (see [Hour thresholds](#hour-thresholds--weekend-hours--soft-warnings-not-hard-caps)).
- **Reopen.** **`reopenTimesheet`** flips `submitted → draft` and clears `submittedAt`,
  letting the owner edit again (within their window; capability-holders anywhere).
- **Read.** `getTimesheet(staffId, weekStartDate)` (server-only) returns the week with
  entries joined to project + company names; self-scoped (another person's requires
  `timesheets.edit`, else `null`). `getSelectableProjects` lists every project (+ its
  company) for the row picker. **`getTimesheetPrefill(staffId, weekStartDate)`**
  (server-only) returns `{ allocations, ptoHoursByDate }` to seed the prefill buttons:
  allocations are derived from **staffed, live (`tentative`/`confirmed`) `project_roles`
  overlapping the week**, mapping each role's `hoursPerDay` onto its active weekdays
  (summed across roles per project, clamped to the 8h cap); PTO is derived from
  **approved (`isPending=false`) `staff_pto` spans** as a full 8h working day per off
  weekday. Auth mirrors `getTimesheet` (own-data always; others need `timesheets.edit`),
  failing **closed to an empty prefill**. It deliberately **never selects the PTO `type`
  column** — that disclosure stays gated behind `pto:["review"]`, so the read leaks no
  leave reasons.

### Hour thresholds & weekend hours — soft warnings, not hard caps

Over-standard hours **and weekend work** are **review signals, not blocks**.
`saveTimesheet.schema.ts` defines two thresholds — `DAILY_HOUR_CAP = 8` (total across
all rows for a single day) and `WEEKLY_HOUR_CAP = 40` — and neither is **`saveTimesheet`
validation**: a day over 8h or a week over 40h still saves *and* submits. (Going *under*
40h is a different matter — see [The 40h floor](#the-40h-floor-full-time-only) below.) They drive two things only: the
grid's warning UI and the autofill/prefill ceiling (cells fill up to the daily cap, never
clobbering typed hours). Weekend hours (any hours on a Sat/Sun) are treated as a **third**
soft signal alongside these — allowed, never rejected, just flagged.

The **only hard ceiling** is `MAX_ENTRY_HOURS = 24` — a single entry can't exceed 24h
(a physical day). That's the sole hour-related rejection in the schema.

When any day is over 8h, the week is over 40h, **or any weekend day has hours**, the grid
(`timesheet-week.tsx`) shows a **warning banner** above Save/Submit — the week "will be
flagged for review by your manager and delivery managers, make sure you've secured their
approval first" — but leaves both buttons enabled. The banner now **enumerates the exact
reason(s)** as a bulleted list, e.g. *"Over 8h on Tue, Wed"*, *"Week total is 46h (over
40h)"*, *"Weekend hours on Sat"*. In the footer, the daily-total cell is highlighted for
over-8h days **and** for weekend days that have any hours; the week-total cell is
highlighted when over 40h. Approval is expected **out-of-band** (there is no in-app
approval workflow — see [Open questions](#open-questions)). See
[ADR 0027](../decisions/0027-timesheet-weekly-model-and-edit-window.md).

> **Both of this grid's banners are now the shared `InlineNotice`** (`src/components/inline-notice.tsx`)
> — they were the two open-coded copies it was extracted from when the project budget form needed the
> same shape ([ADR 0052](../decisions/0052-project-budgets-and-margin.md)). The over-threshold banner
> passes `tone="destructive"`; the unaccounted-hours notice below uses the default muted tone. Don't
> re-open-code a third; and note it is deliberately **not** a form error (no `aria-invalid`, never
> blocks a submit — the *floor* is what disables Submit, not the notice).

### The 40h floor (full-time only)

`WEEKLY_HOUR_CAP` doubles as a **floor on submission**. While the week totals **under**
40h, the grid shows a neutral *"Xh of the 40h week are unaccounted for"* notice naming the
places that time can go (the non-billable buckets, or PTO). For **full-time** staff it
also **disables Submit** — Save draft always stays enabled.

The gate is enforced server-side in `submitTimesheet`, which is the real boundary: it
resolves the person's employment type **as of the week being logged**
(`getEmploymentTypeAsOf(staffId, <week's Sunday>)` — `staff_employment` is effective-dated),
and when `requiresFullWeek(...)` sums the week's `time_entries`, rejecting under 40h with a
`UserSafeActionError`. **Hourly staff are exempt** (a short week is legitimate for them),
as is anyone with no `staff_employment` row yet. There is **no admin override** — a
`timesheets.edit` holder submitting on someone's behalf hits the same floor.

### Submission reminders

Both timesheets pages open with a banner listing the weeks in the ±1 window that still
aren't submitted (`UnsubmittedWeeksBanner`, driven by the pure `unsubmittedWeekAlerts` in
`src/lib/timesheets/timesheet-alerts.ts`, which takes `today` as an argument so the rule is
testable):

- **Last week unsubmitted → `overdue`**, rendered destructive: it drops out of the
  editable window on Monday, after which only `timesheets.edit` can fix it.
- **Current week unsubmitted → `reminder`**, rendered neutral, and only from **Thursday**
  on (`SUBMISSION_REMINDER_WEEKDAY`) — flagging Monday's un-submitted week is noise.

A week with no `timesheets` row counts as unsubmitted. The week editor filters out the
week it's already showing, so it never nags about the sheet on screen.

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
  **plan** (`project_roles`). No reconciliation is built yet; the only link today is the
  **one-way "Fill in allocations" prefill**, which reads `project_roles` to seed suggested
  hours (see [Adding rows & prefill](#adding-rows--prefill)).
- **Staff** — a timesheet belongs to a `staff` record (via `staffId`); the current
  user resolves to it via `staff.userId`. `staff_employment.employmentType` (as of the
  week) decides whether the 40h submission floor applies, read through the shared
  `src/actions/staff/getEmploymentTypeAsOf.ts`.
- **Performance** — billable vs. available hours = utilization (future).

## Open questions

Resolved in v1 (recorded here so they aren't relitigated — see [ADR 0027](../decisions/0027-timesheet-weekly-model-and-edit-window.md)):

- **Can people log against projects they aren't allocated to?** **Yes** — any project
  is a valid target, plus the three non-billable buckets.
- **Approval granularity?** **Deferred — no manager approval in v1.** Submit merely
  locks the week (subject to the 40h floor for full-time staff); there is no
  approve/reject step or per-entry/per-project approval.
  Over-standard-hours weeks (any day > 8h or the week > 40h) **and weekend hours** are
  *allowed* but the grid flags them as **review signals** (spelling out each reason) —
  manager + delivery-manager approval is expected **out-of-band**, not enforced in-app.
- **Lock / correction policy?** Submit locks the week; the owner **reopens** it (within
  their window) to correct, and `timesheets.edit` holders can edit a locked week in
  place. No audit trail on corrections yet.

Still genuinely open:

- **Billing** — invoice generation, and pricing the **logged** hours. Note charge rates
  themselves are no longer missing: a project carries a fixed fee or a per-discipline rate
  card, and margin is computed over its **allocation plan**, never over `time_entries`
  ([ADR 0052](../decisions/0052-project-budgets-and-margin.md),
  [projects.md](./projects.md#budget--margin)). Nothing in this domain reads them yet.
- **Approval workflow** — if/when a manager sign-off step is added (approve/reject,
  audit trail, per-scope granularity).
- **Allocation reconciliation** — surfacing actuals vs. the `project_roles` plan.
- **Utilization reporting** — billable ÷ available hours over a period.
- **PTO ↔ `staff_pto` sync** — the timesheet PTO bucket is independent today; whether
  logged PTO should reconcile with imported Rippling leave is unresolved.
</content>
</invoke>
