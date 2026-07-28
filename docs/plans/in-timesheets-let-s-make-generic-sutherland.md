# Timesheets: submission nudges, hour breakdown, and a 40-hour floor

## Context

Timesheet compliance is weak: people forget to submit, and when they do submit, short
weeks hide unrecorded non-billable or PTO time. Today the weekly grid only warns when
you go **over** the caps, the browse table shows a single undifferentiated `Hours`
number, and nothing tells you that last week is still sitting in draft.

Three changes:

1. A prominent banner on the timesheets pages when last week (or, from Thursday on, this
   week) hasn't been submitted.
2. The browse table breaks total hours into **Project / PTO / Non-billable / Total**.
3. The weekly grid calls out **unaccounted hours** under 40 and — for full-time staff —
   blocks Submit until the week reaches 40.

### Already satisfied: no editing past −1 week

The requested edit-window rule **already exists** and needs no work:
`isWithinEditWindow` (`src/lib/timesheets/timesheet-week.ts:147`) allows only last / this
/ next week; it's enforced server-side for every write by `canEditTimesheet` +
`authorizeTimesheetEdit` (`src/actions/timesheets/canEditTimesheet.ts`) and mirrored in the
UI (`Edit` vs `View` in the list, disabled inputs in the grid). `timesheets.edit`
(manager/admin) bypasses it by design. This plan only *verifies* it (see Verification) and
leans on it in the banner copy.

### Consequences worth naming

- Blocking Submit under 40h **partially reverses ADR 0027**, which chose soft warnings
  because blocking drove under-reporting. Scoped to full-time staff, hourly staff keep the
  message without the block.
- With no admin override (per the chosen option), a manager cannot submit a genuinely
  short week for a full-time person; they'd have to log the missing time as non-billable.

## 1. Unsubmitted-week banner

**New pure module** `src/lib/timesheets/timesheet-alerts.ts` (+ `timesheet-alerts.test.ts`,
matching the `timesheet-grid` / `timesheet-week` pure-module-with-tests pattern):

```ts
export type UnsubmittedWeekAlert = { weekStartDate: string; tone: "overdue" | "reminder" };

/** Weeks in the ±1 window that still need submitting, given `today` (injected → testable). */
export function unsubmittedWeekAlerts(
  weeks: { weekStartDate: string; status: TimesheetStatus; started: boolean }[],
  today: string,
): UnsubmittedWeekAlert[];
```

Rules:
- Previous week (`addWeeks(getWeekStart(today), -1)`) not `submitted` → `"overdue"`.
- Current week not `submitted` **and** today is Thursday–Sunday → `"reminder"`.
- Not-started weeks count as unsubmitted. Weeks absent from `weeks` are treated as
  not-started (defensive; `getTimesheetList` always injects prev/current/next).

Add the weekday helper it needs to `timesheet-week.ts`, beside `isWeekend`:
`export function weekdayIndex(date: string): number` (Mon=0 … Sun=6), plus
`export const SUBMISSION_REMINDER_WEEKDAY = 3; // Thursday`.

**New component** `src/components/timesheets/unsubmitted-weeks-banner.tsx` — a plain
(non-client) presentational component taking `alerts: UnsubmittedWeekAlert[]`, rendering
nothing when empty. Reuse the canonical hand-rolled banner recipe from
`timesheet-week.tsx:469` (there is no `Alert` primitive — do not add one):

- Any `"overdue"` alert → destructive tone: `border-destructive/30 bg-destructive/5
  text-destructive` + `IconAlertTriangle`.
- `"reminder"` only → neutral tone: `border bg-muted/40 text-foreground` + a
  `text-muted-foreground` `IconInfoCircle` (no amber/yellow token exists, and the design
  language is monochrome + indigo — see `.claude/rules/ui.md`).

Copy, one line per alert, each linking to `/timesheets/<weekStartDate>` (`<Button
variant="link" size="sm" render={<Link …/>}>` or a plain link, matching the page's
register), formatted with the existing `getWeekDays` + `formatDate` week-range helper —
lift `weekRange()` out of `timesheets-list.tsx:23` into the new module or a shared spot so
both use one formatter:

- overdue → *"Last week's timesheet (Jul 20 – Jul 26) isn't submitted. You can only edit
  the last two weeks, so submit it before it drops out of range."*
- reminder → *"This week (Jul 27 – Aug 2) isn't submitted yet — it's due by the end of the
  week."*

**Wiring (timesheets pages only):**
- `src/app/(app)/timesheets/page.tsx` — derive alerts from the `rows` it already loads
  (`unsubmittedWeekAlerts(rows, currentDay())`); render above `<TimesheetsList />`. No new
  query.
- `src/app/(app)/timesheets/[week]/page.tsx` — add `getTimesheetList(staffId)` to the
  existing `Promise.all` and render the banner under the header, **filtering out the week
  being viewed** (`alerts.filter(a => a.weekStartDate !== weekStartDate)`) so the page
  doesn't nag you about the sheet you're already on.

## 2. Hour breakdown columns in the browse table

`src/actions/timesheets/getTimesheetList.ts` — widen `TimesheetListRow` with
`projectHours`, `ptoHours`, `nonBillableHours` (keep `totalHours`) and add three
conditional sums to the existing grouped select, e.g.

```ts
projectHours: sql<number>`coalesce(sum(case when ${timeEntries.projectId} is not null
  then ${timeEntries.hours} else 0 end), 0)`.mapWith(Number),
```

- PTO = `category = 'PTO'`; Non-billable = `category is not null and category <> 'PTO'`.
  Compare `${timeEntries.category}::text` against a value typed as `TimesheetCategory`
  (from `@/lib/timesheets/timesheet-category`) rather than a bare literal, so dropping the
  enum member fails the type-check.
- Billable/non-billable is **structural**, not a column: `projectId is not null` ⇒ project
  work, `category is not null` ⇒ non-billable (DB `CHECK` enforces the XOR).
- Give the injected not-started prev/current/next weeks zeros for the new fields.

`src/components/timesheets/timesheets-list.tsx` — columns become
`Week | Status | Project | PTO | Non-billable | Total | [Edit/View]`. New cells are
`text-right tabular-nums`, `—` when 0 (matching the existing `row.totalHours || "—"`),
`Total` in `font-medium`. Note in a comment that PTO is broken out of non-billable, so the
three columns sum to Total.

Widen the page container in `src/app/(app)/timesheets/page.tsx` from `max-w-4xl` to
`max-w-5xl` to fit seven columns.

## 3. Unaccounted hours + 40-hour submit floor

**Shared employment read** — new `src/actions/staff/getEmploymentTypeAsOf.ts`
(`import "server-only"`): latest `staff_employment` row for a staff id with
`effectiveFromDate <= <date>` (order desc, limit 1), returning its `employmentType` or
`null`. Both the page and the action use it, so the rule is derived in one place. Project
explicit columns (per `.claude/rules/database.md`); this mirrors the existing
newest-effective-row pattern (`src/actions/shared/employmentComp.ts`).

**`src/actions/timesheets/saveTimesheet.schema.ts`** — update the `WEEKLY_HOUR_CAP` JSDoc:
it is still a soft *ceiling* warning, but is now also the *floor* Submit enforces for
full-time staff. Add the shared predicate here (pure, client-importable):

```ts
/** Full-time staff must account for a full 40h week before they can submit. */
export function requiresFullWeek(employmentType: string | null): boolean {
  return employmentType === "FULL_TIME";
}
```

**`src/components/timesheets/timesheet-week.tsx`** — new prop
`enforceWeeklyMinimum: boolean` (computed on the page). Alongside the existing
`reviewReasons` block:

- `const unaccounted = WEEKLY_HOUR_CAP - weekTotal;` — when `> 0` and `editable`, render a
  neutral banner (same recipe as above, `IconInfoCircle`) in the actions area:
  *"{unaccounted}h unaccounted for this week. Log the missing time as non-billable
  (Unallocated Bench Time, Internal Admin Work) or as PTO to reach 40 hours."* Shown
  **always while editing**, including an empty grid (per the chosen option).
- When `enforceWeeklyMinimum`, append: *"You can save a draft, but you can't submit until
  the week totals 40 hours."* and set
  `disabled={pending || (enforceWeeklyMinimum && weekTotal < WEEKLY_HOUR_CAP)}` on Submit.
- Keep the existing over-cap destructive banner untouched; the two are mutually exclusive
  (`weekTotal` can't be both under and over 40).

**`src/app/(app)/timesheets/[week]/page.tsx`** — add `getEmploymentTypeAsOf(staffId,
weekDays[6])` to the `Promise.all` and pass
`enforceWeeklyMinimum={requiresFullWeek(employmentType)}`.

**`src/actions/timesheets/submitTimesheet.ts`** — the UI check is an affordance, not the
boundary. Before the upsert (authorization still comes from
`metadata({ authorize: authorizeTimesheetEdit })` — do not hand-write auth in the body):

1. `getEmploymentTypeAsOf(staffId, getWeekDays(weekStartDate)[6])`.
2. If `requiresFullWeek(...)`, sum `time_entries.hours` for that staff/week (join through
   `timesheets`); if the sum `< WEEKLY_HOUR_CAP`, `throw new UserSafeActionError("This
   week only accounts for Xh. Log the remaining hours as project, non-billable, or PTO
   time before submitting.")`.

The grid's save-then-submit relay already surfaces `serverError` via `toast.error` in
`saveAction`/`submitAction`, so no new error plumbing is needed.

## Files touched

| File | Change |
|---|---|
| `src/lib/timesheets/timesheet-alerts.ts` (+ `.test.ts`) | **new** — pure alert derivation |
| `src/lib/timesheets/timesheet-week.ts` | `weekdayIndex`, `SUBMISSION_REMINDER_WEEKDAY` |
| `src/components/timesheets/unsubmitted-weeks-banner.tsx` | **new** — banner |
| `src/actions/staff/getEmploymentTypeAsOf.ts` | **new** — shared employment-type read |
| `src/actions/timesheets/getTimesheetList.ts` | three conditional sums, widened row type |
| `src/actions/timesheets/submitTimesheet.ts` | server-side 40h floor for full-time |
| `src/actions/timesheets/saveTimesheet.schema.ts` | `requiresFullWeek`, JSDoc update |
| `src/components/timesheets/timesheets-list.tsx` | new columns, shared `weekRange` |
| `src/components/timesheets/timesheet-week.tsx` | unaccounted-hours banner, Submit gate |
| `src/app/(app)/timesheets/page.tsx` | banner, `max-w-5xl` |
| `src/app/(app)/timesheets/[week]/page.tsx` | banner, `enforceWeeklyMinimum` prop |

No schema change → no migration, and `scripts/seed/` is unaffected.

## Verification

1. `bun run check` (Biome + `tsc --noEmit` + `bun test`, incl. the new alert tests) and
   `bun run build`.
2. `bun run dev`, signed in as a full-time staff member:
   - `/timesheets` — table shows Project / PTO / Non-billable / Total, the three summing to
     Total; a week with only PTO shows `—` under Project.
   - With last week in draft, both `/timesheets` and `/timesheets/<this-week>` show the
     destructive overdue banner; opening last week's own page hides its own line.
   - Current-week reminder: confirm via a unit test for Wed vs Thu rather than clock
     fiddling (`unsubmittedWeekAlerts` takes `today`).
   - Open the current week: with < 40h the neutral unaccounted banner shows the exact
     shortfall and Submit is disabled; add non-billable/PTO hours to 40 → banner clears,
     Submit enables and succeeds.
   - **Edit window (existing behaviour, verify unbroken):** a week older than −1 shows
     "View", renders disabled inputs, and `saveTimesheet`/`submitTimesheet` reject it.
   - **Server-side floor:** confirm the action rejects a short full-time week even when the
     client is bypassed (temporarily re-enable the button in devtools, or call the action
     directly) — the toast must show the `UserSafeActionError` message.
3. As an hourly staff member (or by flipping `staff_employment.employment_type`): the
   unaccounted banner still shows, Submit stays enabled, and the action accepts a short week.
4. `/audit-rbac` — no gate was changed, but the submit path was touched; confirm clean.
5. Dispatch the **librarian** subagent to reconcile `docs/domains/timesheets.md` and
   **ADR 0027** (the 40h floor narrows its "submission never blocks" stance; note the
   full-time-only scope and the Thursday reminder rule).
