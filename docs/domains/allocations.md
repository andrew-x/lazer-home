# Domain: Allocations

**Status: proposed as a full domain — partially realized.** Staffing People onto
Projects over time — the heart of capacity planning. The first concrete cut of the
Allocation entity **already exists** as `project_roles` in the Projects domain (see
[projects.md](./projects.md)), and a **company-wide planner view**
(`/allocations`) now surfaces that data as a **day/week/month grid**. It is read-only
for most viewers, but two manager-gated actions write from it: `projects.edit` holders
(delivery-manager/manager/admin) can **allocate staff to open roles** directly from a
staff row, and `staff.edit` holders get an inline **Notes** column (see *The planner view*
below). Each cell also carries a **remaining-capacity meter** — the first cross-project
load summing and over-allocation flagging in the app
([ADR 0060](../decisions/0060-allocations-capacity-meter.md)) — but a dedicated capacity
*model*, forecast vs. actuals, and conflict resolution are still proposed.

## The planner view (realized) — mostly a read over `project_roles`

`/allocations` is a **company-wide** grid: **rows = active staff**,
**columns = time buckets** over a user-chosen date range. A **"View by" segmented
toggle** (`ToggleGroup`) picks the column granularity — **Day / Week (default) /
Month** (`Granularity`). It's **almost entirely a view over existing tables**; the sole
schema addition is a nullable free-text **`allocationNotes`** column on `staff`
(`drizzle/0006_empty_whirlwind.sql`) that backs the manager-only Notes column below.
It reads `project_roles` (the plan), `staff` + `staff_employment` (who + their current
facts), and `staff_pto` (availability). The page is **visible to everyone signed in —
no route gate** (the same open-read posture as the staff/CRM/projects lists); it is
**read-only for everyone except two manager-gated writes**: the per-row **Allocate**
action (shown to `projects.edit` holders — see *Allocating from a staff row* below) and
the inline **Notes** column (shown and editable to `staff.edit` holders — managers/admins).

- **Default window + range stepping.** Before the user touches the range, the window is
  the current bucket + the next N−1: **14 days / 12 weeks / 6 months**
  (`DEFAULT_WINDOW`, `defaultWindow(granularity)`), anchored at today. **Switching
  granularity re-seeds the range** to that granularity's default window (a leftover week
  range makes no sense as days). Two calendar endpoint pickers set an explicit range;
  the **prev/next chevrons shift the whole window by one bucket** of the active
  granularity (`planner-range.tsx`, `shiftBy`).
- **What a cell shows — the *nominal rate* at every granularity.** A role's cell shows
  its **project name (a link to `/projects/[id]`, opening in a new tab, mirroring the
  staff-name link)** + its steady-state load = **`hoursPerDay / 8h`** (e.g. 4h/day → 50%,
  8h/day → 100%, capped at 100), with a tooltip (project, role, duration, status, "% of
  {day|week|month}"). **The granularity only changes column width and how the start/end
  edges land**, not the headline percentage — *except* that a week still prorates its
  partial start/end columns (the historical behavior). Specifically (`bucketPercent`):
  - **Day** — one column per **calendar day**; **all 7 days render, weekends dimmed and
    empty** (`bg-muted/30`, `isWeekend`) since the allocation model only counts
    weekdays. An in-range weekday shows the nominal rate; weekends / out-of-range days
    are empty.
  - **Week** — **prorates** partial start/end weeks: `hoursPerDay × (active Mon–Fri
    weekdays that week) / 40` (`weekPercent`), so a mid-week edge or a part-day shows a
    partial %. Unchanged from before.
  - **Month** — one column per **calendar month**; shows the **flat nominal rate** for
    any month the role is active in — **NOT** prorated by how many working days of the
    month it covers. The month containing `startDate`/`endDate` carries the start/end
    edge marker. (Week-vs-month proration inconsistency is deliberate — see
    [ADR 0040](../decisions/0040-allocations-planner-granularity.md).)
- **Time off is prorated over the bucket's working days at every granularity** — away
  weekdays / total weekdays in the column (`awayWeekdays / totalWeekdays`): a day is
  100% when covered, a week divides by 5 (unchanged), a month by its working-day count.
  It renders as a neutral **"Away"** strip (availability only), whose tooltip shows the
  away period's start/end dates and "% of {day|week|month}" (reason gated — see below).
- **Every weekday cell closes with a remaining-capacity meter.** A thin fill bar plus the
  **capacity *left*** as a percentage (`CapacityMeter`, fed by `BucketCell.capacity`).
  Read it as: capacity = **`100 − away`**, load = confirmed + tentative, free =
  `100 − away − load`; over-allocated when that goes negative (the bar turns
  `destructive`, the number reads `-N%`). **PTO nets out of capacity rather than sitting
  beside the blocks** — 40% away + 50% booked = 10% free, and someone fully away who is
  also booked reads over-allocated. **Tentative counts** (you don't double-sell a
  pencilled-in person); paused/cancelled don't, and aren't fetched. `capacity` is **null
  on a zero-working-day bucket** (a weekend day column), so no meter renders there — but
  every weekday cell has one, including empty ones ("100%"). ⚠️ **The meter does NOT sum
  the percentages on the blocks above it** — it runs on `bucketLoadPercent`, a separate
  prorated/uncapped figure; at month granularity two blocks reading "100%" can legitimately
  sit above "0% free". See *Two load figures* below and
  [ADR 0060](../decisions/0060-allocations-capacity-meter.md).
- **Column headers are granularity-aware** (`columnLabel`): a day is `Mon, Jul 6`, a
  week is a compact Mon–Fri range `Jul 6–10` / `Jun 29–Jul 3` (`weekColumnLabel`), a
  month is `Jul 2026`. **Confirmed** roles render as a solid block, **tentative** as a
  dashed outline; a solid bar on a cell's leading/trailing edge marks the column a role
  starts/ends in.
- **Staff column.** Each person's name is a **link to their `/staff/[id]` profile
  (opens in a new tab)**, and **hourly** staff (`employmentType === "HOURLY"`) carry an
  **"Hourly" badge**. `employmentType` is threaded onto the `AllocationRow` for this.
- **Notes column (manager/admin-only, inline-editable).** Immediately right of the
  staff name sits a free-text **Notes** column — a plain planning note about a person's
  staffing (e.g. "on bench after Aug 15, wants frontend work"), stored on
  `staff.allocationNotes`. It is **shown only to viewers holding `staff.edit`** and
  **hidden entirely otherwise**: `getAllocationsGrid` computes `canEditNotes =
  userHasPermission(user, { staff: ["edit"] })` and only projects the note value when
  true (defense in depth — the string never ships to an unprivileged client), and the
  grid renders the column only when `canEditNotes`. Each cell (`allocation-note-cell.tsx`)
  is a **debounced-autosave (600 ms) textarea** that grows vertically, with a subtle
  inline Saving…/Saved/error status (never a toast). Writes go through
  `updateStaffAllocationNotes`, gated on the **static `staff.edit` capability — NOT the
  owner-or-`staff.edit` `authorizeStaffEdit` hook the profile fields use**, because these
  are cross-person staffing notes on a management planner (a person editing only their own
  row isn't the intent). See [ADR 0041](../decisions/0041-allocation-notes-on-staff.md)
  and [permissions.md](./permissions.md).
- **Allocating from a staff row (manager-gated write).** Each staff row carries a per-row
  **Allocate** (`+`) button, shown only to `projects.edit` holders
  (delivery-manager/manager/admin) via a `canAllocate` flag computed in `getAllocationsGrid`
  and threaded to the grid (mirroring the `canEditNotes` gate). It opens a dialog
  (`allocate-dialog.tsx`) to **search unallocated roles** — open positions (`staffId IS NULL`)
  in `tentative`/`confirmed` status, matched on project name or role description across the
  whole company (**no line-of-business pre-filter**) via `searchUnallocatedRoles`. Picking a
  role **prefills its date range + hours/day**; the user adjusts them, then saves. Saving
  assigns the person to that **existing** open role — it does not create a new one.
  `allocateStaffToRole` (gated `projects.edit`) guards, in a transaction, that the role is
  still unallocated and in a live state before writing `staffId` + dates + hours, so a
  placeholder can't be silently overwritten and two concurrent assignments can't both win.
  This is a **separate action from the opportunity planner's `assignRoleStaff`**, which is
  opportunity-scoped (`assertRoleEditable`) and only sets `staffId` — see *Code map*.
- **What appears.** Only **staffed** roles (non-null `staffId` — placeholders/open
  positions have no person to row) with status **`tentative` or `confirmed`**;
  `paused`/`cancelled` roles are excluded (not an active allocation). Only **approved**
  (non-pending) PTO is shown.
- **PTO disclosure is minimal, and gated.** Everyone sees the reason-free "Away"
  strip **plus the away period's start/end dates** (the min-start/max-end across the
  leave spans overlapping that week — availability info); only the leave **type** is
  gated, revealed to viewers holding **`pto.review`** (`getAllocationsGrid` nulls the
  `type` field otherwise). Showing the dates is still just availability, not reason —
  the gate is unchanged. See [ADR 0038](../decisions/0038-allocations-planner-pto-disclosure.md)
  and [permissions.md](./permissions.md).
- **Filter bar.** Narrows the staff rows in-memory (the once-fetched-list pattern the
  staff directory uses) by name, line of business, employment type, role, and skills.
  The skills multi-select is the shared `src/components/form/skills-filter.tsx`
  (extracted from the staff directory, now used by both). The **Role** filter is a
  **multiselect** (`MultiSelectFilter` chips, `src/components/form/filters.tsx`), not the
  single-select the other lists use, and **defaults to the billable disciplines** —
  `roleOptions.filter(isBillableRole)` (the `isBillableRole` predicate + `NON_BILLABLE_ROLES`
  from `src/lib/staff/staff-enums.ts` are the single source of the billable/overhead split,
  also used by the staff-import `isBillable` derivation), intersected with the roles actually
  present in the data — so the planner opens on the people who bill client work rather than
  the whole company. Its semantics differ from
  `SelectFilter`: **there is no `ALL` sentinel — the selection *is* the accepted set**, so
  clearing it matches no one and the "No staff match these filters" empty state shows.

### Two load figures — `bucketPercent` vs `bucketLoadPercent`

`src/lib/allocations/allocations-grid.ts` exports **two** per-role percentage functions.
They are not interchangeable and the difference is the single most misleading thing in
this domain:

| | `bucketPercent` (what a **block** shows) | `bucketLoadPercent` (what the **meter** sums) |
|---|---|---|
| Meaning | a display **rate** — "this project wants them at 50%" | the role's **real share of the bucket's working capacity** |
| Cap | capped at 100 | **uncapped** (a 12h/day role is 150%) |
| Month | **flat** nominal rate, not prorated ([ADR 0040](../decisions/0040-allocations-planner-granularity.md)) | **prorated** by active weekdays / working days in the month |
| Week | prorated (`weekPercent`) | prorated — same answer |
| Day | flat nominal rate on an in-range weekday | same answer |
| Returns | a rounded whole percent | a **raw float** — the caller rounds once, after summing |

- **The month is the only divergence, and it's the reason the second function exists.**
  Two back-to-back half-month roles each display their nominal 100%; summing those would
  say 200% for a person who is exactly full. Prorated, they contribute 50% each and the
  meter reads 0% free. The tooltip's month-only line *"Averaged across the month's working
  days"* is the user-facing explanation.
- **`bucketPercent`/`weekPercent` were deliberately left alone.** `weekPercent` is imported
  by `src/lib/projects/project-planner-grid.ts` (the opportunity planner), so the new
  behaviour was **added** rather than folded in — ADR 0040's "keep both call sites in step"
  rule is preserved, and the opportunity planner is unaffected.
- **Round once, from the raw sum**, never sum rounded parts: `buildAllocationRows`
  accumulates unrounded confirmed/tentative load plus the raw away share (*not*
  `timeOff.percent`, which is already rounded), and rounds when it builds the
  `CapacityCell`. Three 33.3% roles therefore read "0% free", not "1% over".
- **The baseline is a flat 8h/day, 40h/week for everyone.**
  `staff_employment.utilizationTarget` is deliberately **not** used — non-billable roles
  carry target 0 by invariant (`src/lib/staff/employment.ts`), so a target-relative meter
  would mark every overhead person permanently over-allocated.
- **Not honoured:** `staff.joinDate`/`terminationDate` (someone leaving mid-window still
  shows capacity across it), holiday calendars, and part-time contracts. Each makes a cell
  read *more* free than the person is.

### Code map

- **Read:** `src/actions/allocations/getAllocationsGrid.ts` (server-only; also
  re-exports `allocationsFilterOptions = STAFF_FILTER_OPTIONS`). Two-query
  latest-employment-per-person fold (no N+1), mirroring `getStaffDirectory`. Selects
  `staff.allocationNotes`, computes `canEditNotes`, and only projects the note when the
  viewer holds `staff.edit` (`AllocationsGridData` carries `canEditNotes`;
  `AllocationStaffRow.allocationNotes: string | null`).
- **Notes write:** `src/actions/staff/updateStaffAllocationNotes.ts` (+ `.schema.ts`,
  a client-importable pure module sharing one zod schema with the inline editor). Gated
  on `metadata.permission: { staff: ["edit"] }`; revalidates `/allocations`.
- **Allocate — search + write** (both gated `metadata.permission: { projects: ["edit"] }`):
  - `src/actions/allocations/searchUnallocatedRoles.ts` — type-ahead over open roles
    (`isNull(staffId)`, status in `tentative`/`confirmed`), `ilike` on project name **or**
    role description. Returns a rich `UnallocatedRoleOption` (project + role type + LoB +
    dates + hours) rather than the generic `{ id, name }` search shape, so the dialog can
    prefill; the dialog's picker is built on the same Base UI `Combobox` as `EntityCombobox`
    but carries that richer option.
  - `src/actions/allocations/allocateStaffToRole.ts` (+ `.schema.ts`, a client-importable
    pure module reusing the shared `endOnOrAfterStart` refinement from
    `projects/projectRole.schema.ts`) — updates `staffId` + `startDate`/`endDate`/`hoursPerDay`
    on an existing open role, guarding it is still unallocated + live (throws
    `UserSafeActionError` otherwise); revalidates `/allocations`, `/projects`, `/opportunities`.
    Distinct from `projects/assignRoleStaff.ts` (opportunity-scoped, staffId-only) because the
    planner allocates over any open role without an opportunity context.
- **Inbound revalidation — this grid's rows are `project_roles`, so project writes refresh it.**
  Every projects-domain mutation now goes through **`revalidateProject`**
  (`src/actions/projects/revalidate.ts`), which hits `/projects`, `/projects/[id]`,
  `/opportunities` **and `/allocations`**. So a role added, re-dated, re-staffed or deleted from
  the **project detail page** (`/projects/[id]` — the delivery-side editor, from either its Roles
  table or its Timeline Gantt,
  [ADR 0045](../decisions/0045-project-page-as-delivery-side-role-editor.md)) appears here
  immediately, including on **confirmed** roles the opportunity planner won't touch. If you add
  a new project/role write, route its revalidation through that helper rather than a bare
  `revalidatePath("/projects")` — otherwise this grid goes stale.
- **Pure grid math:** `src/lib/allocations/allocations-grid.ts` — builds the
  column spine at the chosen granularity (`buildColumns` → `eachDay`/`eachWeek`/
  `eachMonth`), folds staff + roles + PTO into one row per person, and computes each
  column's percentage via **`bucketPercent(role, granularity, colStart)`**: `weekPercent`
  for weeks (the prorated `hoursPerDay × active weekdays / 40`), the flat `nominalRatePercent`
  (`hoursPerDay / 8h`, capped at 100) for an in-range day or month. Exports the
  `Granularity` type + `GRANULARITIES` / `GRANULARITY_LABELS` / `DEFAULT_WINDOW` /
  `defaultWindow` / `buildColumns` / `columnLabel` / `bucketPercent` /
  **`bucketLoadPercent`** (the capacity figure — see *Two load figures* above) and the
  **`CapacityCell`** type, and still
  **`weekPercent`** + `WORKING_DAYS_PER_WEEK`. Client-importable (no `db`/drizzle),
  reusing the timesheet date helpers. **Types were renamed for the multi-granularity
  move:** `WeekCell` → **`BucketCell`**, and `AllocationRow.weeks` → **`AllocationRow.cells`**;
  `buildAllocationRows` gained `columns` (was `weekColumns`) and `granularity` params.
  `AllocationRow` also carries **`allocationNotes`** (threaded from the read above).
  **`src/lib/projects/project-planner-grid.ts`** (the opportunity planner's grid, still
  weekly-only) still **imports `weekPercent` from here** rather than duplicating the
  math, so the two planners agree on a week's load — keep this the single source and
  update both call sites when the load formula changes.
- **Date helpers:** `src/lib/timesheets/timesheet-week.ts` grew the day/month math the
  grid needs — `addDays`, `getMonthStart`, `addMonths`, `eachDay`, `eachMonth`,
  `currentDay`, `currentMonthStart` (alongside the existing week helpers). Still **no
  date library** — string-based local-parts arithmetic throughout.
- **UI:** `src/components/allocations/allocations-planner.tsx` (filter bar + granularity
  state + "View by" toggle + window), `planner-range.tsx` (granularity-aware prev/next
  stepping + aria-labels), `allocations-grid.tsx` (render-only grid + legend, taking
  `columns`/`granularity` props, dimming weekend day-columns, granularity-aware labels
  and tooltip copy; holds the internal **`CapacityMeter`** rendered last in each cell's
  stack, plus the legend's "Capacity left" / "Over-allocated" entries; renders the
  manager-only Notes column when `canEditNotes` and the
  per-row Allocate button when `canAllocate`, calling an `onAllocate(row)` callback),
  `allocation-note-cell.tsx` (the debounced-autosave note editor), `allocate-dialog.tsx`
  (the role-search + date/hours dialog; the planner holds its open-state and renders it for
  the targeted staff row), page `src/app/(app)/allocations/page.tsx`. Nav entry added to `NAV_ITEMS`
  (`src/components/app-shell/nav.ts`), ungated.

> **This is a *view* with a capacity indicator on it — still not the capacity model.**
> It now **does** sum a person's load across projects per cell, net PTO out of it, and
> flag over-allocation ([ADR 0060](../decisions/0060-allocations-capacity-meter.md)).
> **Separately**, the **Utilization report** (`/dashboards/utilization`) sums that same
> load again over a reporting window and reconciles it against submitted-timesheet
> actuals, read-only — see [utilization.md](./utilization.md) and
> [ADR 0062](../decisions/0062-utilization-report-two-series-and-timesheet-disclosure.md).
> What neither does: model a person's real capacity (the baseline is a flat 40h week for
> everyone — no `utilizationTarget`, no part-time, no joiners/leavers, no holidays), roll a
> window up into a per-person verdict, sort or filter by free capacity, or resolve a
> conflict once flagged. Those remain the open questions below.

## Utilization: the plan read against the actuals

`/dashboards/utilization` is the read-only reporting counterpart to this planner, and the
first surface anywhere that puts `project_roles` (the plan) and `time_entries` (the actuals)
side by side. It matters to this domain in four ways, all detailed in
[utilization.md](./utilization.md):

- **It shares this domain's arithmetic.** `HOURS_PER_DAY` is now **exported** from
  `src/lib/allocations/allocations-grid.ts` (it was private) so the report's available-hours
  denominator is the same 8 h day this grid calls 100% — don't re-declare it a third time.
  `EndpointPicker` was extracted from `planner-range.tsx` to
  `src/components/form/endpoint-picker.tsx` and is now shared by both range controls.
- **It sums a person's load across projects over the reporting window, and does not clamp
  it.** Two overlapping full-time roles read as 200% there. The grid's own capacity meter
  (above) does the equivalent sum per cell; the report repeats it over an arbitrary date
  range and pairs it against actuals, which the grid still can't do.
- **It inherits this planner's PTO posture exactly** — approved leave dates in, leave **type**
  never selected ([ADR 0038](../decisions/0038-allocations-planner-pto-disclosure.md)).
- **It reads `tentative` roles behind a forecast toggle** (full weight; there is no
  win-probability field to weight by) and `confirmed` roles always.

## Purpose

Decide who works on what, when, and how much — and keep the plan reconcilable against availability and actuals.

## Key entities

- **Allocation** — a *time-ranged* assignment of a Person to a Project: start/end dates, capacity (% or hours/week), and project role.
  - **First cut realized as `project_roles`** (`src/lib/db/projects-schema.ts`): a
    staffing line = a `staff` member (or a **placeholder / open position** when `staffId`
    is null) of a given `roleType` (discipline) for a `startDate`/`endDate` range at
    `hoursPerDay` (default 8). **Line of business lives on the *role*** (NOT NULL
    `project_roles.lineOfBusiness`) — a project's LoBs are *derived* from its roles, so one
    project can span practices ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md),
    reversing [ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)'s
    project-level placement; `projects.lineOfBusiness` no longer exists).
    It's a **data-carrying row**,
    not a pure junction. Placeholders let a Project define needed roles before anyone is
    chosen (e.g. during an opportunity's Allocating stage). Today these are **simple
    mutable rows, NOT effective-dated history** like `staff_employment` — so they can't
    reconstruct a past plan. A placeholder can now be **staffed after the fact** from the
    allocations planner's per-row Allocate action (`allocateStaffToRole` — see *The planner
    view*), in addition to the opportunity planner's inline assign.
    When this domain grows beyond create+read, `project_roles` may need to evolve toward
    history-as-rows. See [projects.md](./projects.md),
    [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md), and
    [ADR 0024](../decisions/0024-opportunity-project-handoff-and-placeholder-roles.md).
  - **Soft vs. hard is now modelled.** A role carries a **`status`** (`tentative` →
    `confirmed`) plus an **`opportunityId`** provenance FK. A role planned against an
    opportunity is `tentative` (soft — editable in that opportunity's planner) and
    **auto-confirms** (hard — locked) when the opportunity is won. This is the first concrete
    answer to the soft/hard question below, still as a **status flag on simple rows**, not
    effective-dated history. See [projects.md](./projects.md) and
    [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md).

## Key flows

- **Staffing** — given a Project's needs, find People with the right StaffProfile skills and spare capacity, then allocate them for a date range. **First realized cut:** the allocations planner's per-row **Allocate** action assigns a person to an open `project_roles` placeholder over an adjustable date range + hours/day (`allocateStaffToRole`); the opportunity planner also assigns inline. Skill/capacity matching is not yet part of the flow.
- **Capacity planning** — sum each Person's allocations across Projects vs. their availability to spot over/under-allocation. **First realized cut:** the planner's per-cell capacity meter does exactly this sum, against a flat 40h week minus PTO, and flags anyone over ([ADR 0060](../decisions/0060-allocations-capacity-meter.md)). It is a *display*, not a model — see the open questions.
- **Forecast vs. actuals** — Allocations are the *plan*; TimeEntries are the *actuals*. Comparison drives re-forecasting.

## Connects to

- **Staff profiles** — skills + availability drive who can be allocated.
- **Timesheets** — actuals (`time_entries`) are logged against the same Person↔Project pairing (now **built**; logging isn't restricted to allocated projects). **Reconciling actuals against the `project_roles` plan is now built, read-only**, as the Utilization report's two series — see [domains/utilization.md](./utilization.md) and [domains/timesheets.md](./timesheets.md).
- **Performance** — utilization (from allocations vs. availability) is a performance input. The measurement now exists at `/dashboards/utilization`; nothing feeds it into a review yet.

## Open questions

- Capacity unit: percentage, hours/week, or both?
- ~~Soft (tentative) vs. hard (confirmed) allocations?~~ **Resolved** — a role's `status`
  (`tentative` → `confirmed`, auto-confirmed on the opportunity's win) models exactly this.
  See [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md).
- ~~How is over-allocation *surfaced*?~~ **Partly resolved, at two levels.** The planner's
  per-cell **capacity meter** sums confirmed + tentative load across projects, subtracts
  PTO, and flags anyone past 100% ([ADR 0060](../decisions/0060-allocations-capacity-meter.md));
  the **Utilization report** sums that same load again over a reporting window and likewise
  does not clamp it ([ADR 0062](../decisions/0062-utilization-report-two-series-and-timesheet-disclosure.md) §6).
  Neither **resolves** anything: there is no warning at the point of allocating, no block, and
  no suggested fix, and the same visibility is missing from the **opportunity planner**, which
  only greys a staffed person's other-project commitments in without totalling them.
- ~~How are the planner-view percentages (the *plan*) reconciled against timesheet actuals?~~
  **Resolved for reporting** — the Utilization report's planned/confirmed pair, with a variance
  and submitted-week coverage ([utilization.md](./utilization.md)). Still unbuilt: reconciliation
  as a *workflow* (re-forecasting, flagging a role whose actuals have diverged, anything that
  writes back) — the planner grid itself still measures only against itself.
- **A real per-person capacity model is still missing.** The meter's denominator is a flat
  8h/day, 40h/week for everyone: `staff_employment.utilizationTarget` is unusable as-is
  (non-billable ⇒ 0), and part-time contracts, `staff.joinDate`/`terminationDate` and
  holiday calendars are all unmodelled. Every one of those makes the meter read
  optimistically.
- **No rollup, no sort, no filter on capacity.** Over-allocation is visible per cell only;
  nothing answers "who is free in September" or "who is oversold this quarter" without
  reading the grid. The row sort still keys off `latestConfirmedEnd` (soonest-to-free),
  not the meter.
- **Planned figures for a past range aren't historically faithful** — `project_roles` is mutable
  with no history ([ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md)), so
  last quarter's report reflects the plan as it stands *now*. This is the strongest argument yet
  for history-as-rows here.
