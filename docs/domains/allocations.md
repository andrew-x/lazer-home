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

The same `getAllocationsGrid` read now backs **two further surfaces**: the **home
dashboard's "Lazer Status" band** — a *point-in-time* staffing snapshot of the whole org
(who is on a confirmed role today, who is free which week, what starts/ends in 28 days,
who is lent across lines of business), see *The home dashboard's "Lazer Status"* below and
[ADR 0063](../decisions/0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md) —
and the **Utilization report** (`/reporting/utilization`), which reconciles the same plan
against timesheet actuals over a chosen range.

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
  ⚠️ **`DELIVERY` roles now consume capacity here.** Since
  [ADR 0069](../decisions/0069-delivery-managers-as-project-roles-and-coverage-gaps.md) a delivery
  manager holds an ordinary dated, hourly role, so running an engagement shows up as load where it
  used to be invisible — the meter's figures moved on existing plans. (The seed gives delivery roles
  1–2 h/day precisely so a manager on three engagements doesn't read as 300%.) **The coverage rule
  in `delivery-coverage.ts` deliberately does *not* match this meter's status filter** — it counts
  everything but `cancelled`, because it asks "does the plan account for delivery" rather than
  "whose capacity is consumed"; see
  [projects.md](./projects.md#delivery-managers--coverage).
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
  `AllocationStaffRow.allocationNotes: string | null`). **Wrapped in `React.cache`** — the
  planner and the home dashboard both read it and it takes no arguments, so one render costs
  one set of queries. It returns **two role arrays**: `roles` (staffed) and **`openRoles:
  OpenRoleRow[]`** = `Omit<AllocationRoleRow, "staffId">`, the unstaffed placeholder
  positions. The `staffId IS NOT NULL` predicate is **not** in the WHERE clause any more —
  the role query fetches both and the split happens in JS over one result set, so `roles` is
  unchanged for every existing consumer and there is **no extra round trip**. Keeping
  vacancies in a *separate array* rather than nullable-`staffId` rows is what stops the
  planner grid / availability / utilization from ever counting a vacancy as a person
  ([ADR 0063](../decisions/0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md) §8).
  It also **fails closed without a session** — no capability gate (project-role reads are
  open to every signed-in user), but a read this wide returns the empty projection rather
  than trusting the `(app)` layout's redirect to have happened. The home dashboard's
  deleted `getOrgUtilization` had that guard; when it went, the guarantee moved here.
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
> **Separately**, the **Utilization report** (`/reporting/utilization`) sums that same
> load again over a reporting window and reconciles it against submitted-timesheet
> actuals, read-only — see [utilization.md](./utilization.md),
> [ADR 0062](../decisions/0062-utilization-report-two-series-and-timesheet-disclosure.md) and
> [ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md).
> ⚠️ **The two surfaces deliberately disagree about the same person:** this meter counts
> `tentative` load alongside `confirmed`, while the report counts **confirmed only** — the planner
> forecasts, the report measures ([ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md) §2).
> What neither does: model a person's real capacity (the baseline is a flat 40h week for
> everyone — no `utilizationTarget`, no part-time, no joiners/leavers, no holidays), roll a
> window up into a per-person verdict, sort or filter by free capacity, or resolve a
> conflict once flagged. Those remain the open questions below.

## The home dashboard's "Lazer Status" — the same data, as of today

`/` (`src/app/(app)/page.tsx`) has two bands, and the second one is a **third consumer of
this domain's data** alongside the planner and the utilization report. Read
[ADR 0063](../decisions/0063-home-dashboard-two-time-bases-and-point-in-time-staffing.md)
before changing anything here — the time bases are load-bearing.

- **Your Status — mostly year to date.** Personal tiles (PTO taken, Utilization, Planned) from
  submitted timesheets via `getStaffUtilization` + `src/lib/timesheets/utilization.ts`, plus
  **`MyAllocationsTable`** (Project · Client · Dates · Hours/day; live rows, then an
  "Upcoming" divider) over `getMyAllocations` + `buildMyAllocationRows`
  (`src/lib/home/my-work.ts`). **This band also carries a point-in-time block that has nothing to do with allocations** — the CRM personal task list ([ADR 0065](../decisions/0065-home-personal-task-list-and-assignee-completion.md)), which is why the band description no longer names a single window. Rows are **one per project** (two roles on one engagement
  merge, hours summed) and `status` reads `tentative` only when *every* role on the project
  is. There is deliberately **no link to `/allocations`** from this band.
  **The delivery-manager special case is gone**
  ([ADR 0069](../decisions/0069-delivery-managers-as-project-roles-and-coverage-gaps.md)): a
  delivery manager holds a dated, hourly `DELIVERY` role like anyone else, so its row renders like
  any other allocation with `Delivery` in the role-type sub-line. `my-work.ts` lost
  `managedProjects`, `deliveryManagerOnly` and every null branch — **`MyAllocationRow`'s
  `hoursPerDay`/`startDate`/`endDate` are non-nullable again** — and the table lost its
  "Delivery lead" badge and em-dash hours cell. That whole class of nullability existed *only*
  because the junction had no dates or hours (the row had to borrow its window from whoever else was
  staffed, and inventing hours would have corrupted a column people read down). Consequence:
  **delivery work now counts toward `currentLoadPercent`.**
  ⚠️ **`getMyAllocations` has no forward bound** — `endDate >= today`, everything upcoming.
  It used to clip to a deleted gantt's −1/+2-month window; don't reintroduce a clip.
  Nuance: the **Planned** tile's *value* is year-to-date, but its *hint* flips to
  "Over-allocated — N% committed today" from `currentLoadPercent(roles, today)` — a
  point-in-time, confirmed-only, **uncapped** sum. Two windows in one tile, on purpose.
- **Lazer Status — point in time, from the plan.** A Client Component
  (`src/components/home/lazer-status-section.tsx`) over the pure
  **`src/lib/home/org-status.ts`**, folded from `getAllocationsGrid` — so five panels and
  three filters cost **one** set of queries, shared with `/allocations` through
  `React.cache`. It reads **no timesheets**: partial submission would otherwise read as an
  idle bench.

### The definitions Lazer Status depends on

- **Staffed** = holds **≥ 1 `confirmed` role whose span contains today**. Tentative doesn't
  commit anyone; **approved leave today does *not* un-staff someone** (this measures the
  plan, not attendance — availability, right beside it, is where leave nets out).
  ⚠️ **A `DELIVERY` role staffs you** — since
  [ADR 0069](../decisions/0069-delivery-managers-as-project-roles-and-coverage-gaps.md) running an
  engagement is an ordinary dated role, so the staffing count moved on existing data. There is **no
  role-type filter and none should be added**: running a project is committed delivery work.
- **Population** = `isBillable === true`, the *same* predicate as `buildAvailability`, so the
  staffing rate and the availability strip can't disagree about who counts.
- **`rate`** = staffed ÷ headcount. **`normalizedRate`** = staffed ÷ **full-time** headcount,
  **deliberately uncapped** (staffed hourly staff can push it past 100%, which is the signal)
  and `null` — never `0` — when nobody is full time.
- **The by-role breakdown keys off `staff_employment.role`** (the *person's* discipline), not
  `project_roles.roleType` (the *work's*). Empty disciplines render "—", not 0%.
- **It counts people, not hours** (the hours-weighted question is
  [utilization.md](./utilization.md)) and carries **no target column** and **no small-cohort
  suppression** — these are headcounts over allocations `/allocations` already publishes by
  name. See ADR 0063 §4 before adding a guard by analogy with the gated dashboards.

### The five panels

| Panel | Shows | Notes |
|---|---|---|
| `staffing-panel.tsx` | Staffed now / Headcount / Staffed rate / Normalized + a by-discipline table over the **five delivery disciplines** (Engineer, Designer, Architect, Delivery, QA) | Replaced a YTD, timesheet-driven `utilization-panel.tsx`. Overhead roles aren't rows — they're never staffed onto client work; anyone billable outside those five falls into `Other`, which appears only when non-empty so the rows still account for exactly the Overall population |
| `availability-panel.tsx` | **Week tabs** (Bench, +1…+4 wk) + a Full time/Hourly/All filter. Tab 0 is the bench; each later tab lists only who **newly frees up** that week | Client component. The tabs are **deltas, not running totals** (`buildAvailabilityTabs`) — a cumulative list re-printed the standing bench in every tab and buried the people whose project actually ends that week. Consequence: the tab counts don't sum to "people with capacity", so `freeFte` carries the cumulative capacity view |
| `upcoming-time-off-panel.tsx` | Approved leave within 30 days, each row carrying the **project** the absence leaves short | Leave *reason* rendered only when `type` is non-null (ADR 0038) |
| `project-roles-panel.tsx` | Roles within **28 days** (`UPCOMING_ROLES_HORIZON_DAYS`), **grouped by project**, including **unfilled** open positions badged `Unfilled`. Rendered **twice** — as "Starting soon" and "Ending soon" | Two cards, not one with two lists: they prompt different work (find people vs. find their next engagement). Grouped by project via `groupRolesByProject` because roles are stored per seat but sold and staffed per engagement — three engineers rolling onto one project is *one* thing to plan for. A short engagement can still appear in both cards |
| `borrowed-staff-panel.tsx` | People on a **confirmed** role today whose LoB differs from their own home LoB | The named-people twin of the report's `buildLobAlignment` aggregate — keep both |

### Two constraints that will bite

1. **`buildOrgStatus`'s output is a Client Component prop, so it is serialized into the page
   HTML for every viewer.** It therefore **copies staff fields one at a time and never
   spreads the staff row** — `AllocationStaffRow` carries `allocationNotes` (gated on
   `staff.edit`, [ADR 0041](../decisions/0041-allocation-notes-on-staff.md)) and `skills`,
   and a spread would ship whatever sensitive column lands upstream next. Two tests in
   `org-status.test.ts` assert this against the *serialized* payload. PTO `type` is nulled
   upstream by the read and **passed through, never re-derived**.
2. **The filters re-derive their own counts.** `summarizeWeeks(people, weekStarts)` was
   extracted from `buildAvailability` precisely so the client can recompute availability
   counts over a filtered subset; reusing the server's unfiltered numbers would print the
   whole company's availability above a filtered name list. The line-of-business filter
   matches each person's **home** LoB on every panel — the sole exception being an **open**
   upcoming role, which has no holder and falls back to the role's own LoB.
   The week *columns* come from **`availabilityWeekStarts(fromWeek)`**, not from any
   person's `weeks` array: they are a fact about the calendar, and deriving them from
   `people[0]` collapsed to zero columns whenever nobody was billable.

### Home-dashboard code map

- **Reads:** `getAllocationsGrid` (below — now also returns `openRoles`) ·
  `src/actions/allocations/getMyAllocations.ts` (own-data-only **by construction** — takes no
  `staffId`, so there is no cross-user id to authorize. **One query now**: every live-or-upcoming
  role, `DELIVERY` ones included, so `MyManagedProject`/`managedProjects` and the `min`/`max`
  group-by query are deleted —
  [ADR 0069](../decisions/0069-delivery-managers-as-project-roles-and-coverage-gaps.md)) ·
  `src/actions/staff/getStaffPto` ·
  `src/actions/timesheets/getStaffUtilization`.
- **Pure math:** `src/lib/home/org-status.ts` (+ `.test.ts`, 41 tests) — `buildOrgStatus`,
  `summarizeStaffing`, `filterByLineOfBusiness`, `filterByEmploymentType` (the availability
  panel calls it rather than re-filtering inline, so the employment filter has one
  definition), `UPCOMING_ROLES_HORIZON_DAYS`. ·
  `src/lib/home/my-work.ts` (+ `.test.ts`) — `buildMyAllocationRows` (**buckets each role
  live-vs-upcoming *before* merging per project — merging first would report a future
  role's hours as today's commitment and hide its start date; one project may therefore
  appear in both lists**),
  `currentLoadPercent`. · `src/lib/allocations/availability.ts` (+ `.test.ts`) —
  `buildAvailability`, the extracted **`summarizeWeeks`**, `buildUpcomingTimeOff` (which
  takes `roles` purely to name each absence's affected projects) and the thresholds
  `AVAILABILITY_WEEKS` / `AVAILABLE_THRESHOLD_PERCENT` (50) /
  `UPCOMING_TIME_OFF_HORIZON_DAYS` (30).
- **UI:** `src/components/home/` — `home-section.tsx` (its `action` slot is reserved for a
  control that scopes the *whole* band) + `lazer-status-section.tsx` + the five panels +
  `my-allocations-table.tsx` + `person-row.tsx` (its `subtitle` prop *replaces* the
  "Core · Engineer" meta line) + the shared `StatCard`.
- **Deleted here, don't resurrect:** `src/components/home/allocation-timeline.tsx`,
  `src/lib/home/allocation-timeline.ts`, `src/components/home/utilization-panel.tsx`,
  `src/actions/timesheets/getOrgUtilization.ts`.

## Utilization: the plan read against the actuals

`/reporting/utilization` is the read-only reporting counterpart to this planner, and the
only surface that reconciles `project_roles` (the plan) against `time_entries` (the actuals).
It never shows them side by side: a **`Planned | Logged` basis toggle** picks one, and the other
is spent on **deviation flags**. It matters to this domain in four ways, all detailed in
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
- **It reads `confirmed` roles only** — `tentative` roles were dropped from it outright, because a
  forecast isn't an allocation and there is no win-probability field to weight one by
  ([ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md) §2).
  **This planner's capacity meter still counts them**, so the same person can read differently on
  the two surfaces — deliberately.

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
- **Timesheets** — actuals (`time_entries`) are logged against the same Person↔Project pairing (now **built**; logging isn't restricted to allocated projects). **Reconciling actuals against the `project_roles` plan is now built, read-only**, as the Utilization report's Planned/Logged bases plus its deviation flags — see [domains/utilization.md](./utilization.md) and [domains/timesheets.md](./timesheets.md).
- **Performance** — utilization (from allocations vs. availability) is a performance input. The measurement now exists at `/reporting/utilization`; nothing feeds it into a review yet.

## Open questions

- Capacity unit: percentage, hours/week, or both?
- ~~Soft (tentative) vs. hard (confirmed) allocations?~~ **Resolved** — a role's `status`
  (`tentative` → `confirmed`, auto-confirmed on the opportunity's win) models exactly this.
  See [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md).
- ~~How is over-allocation *surfaced*?~~ **Partly resolved, at two levels.** The planner's
  per-cell **capacity meter** sums confirmed + tentative load across projects, subtracts
  PTO, and flags anyone past 100% ([ADR 0060](../decisions/0060-allocations-capacity-meter.md));
  the **Utilization report** sums that same load again over a reporting window and likewise
  does not clamp it ([ADR 0062](../decisions/0062-utilization-report-two-series-and-timesheet-disclosure.md) §6,
  which [ADR 0064](../decisions/0064-utilization-single-basis-toggle-and-cohort-wide-logged-gate.md)
  leaves standing — though the report counts **confirmed roles only**, so it and the meter can read
  differently for the same person).
  Neither **resolves** anything: there is no warning at the point of allocating, no block, and
  no suggested fix, and the same visibility is missing from the **opportunity planner**, which
  only greys a staffed person's other-project commitments in without totalling them.
- ~~How are the planner-view percentages (the *plan*) reconciled against timesheet actuals?~~
  **Resolved for reporting** — the Utilization report's Planned/Logged bases, its deviation flags
  and submitted-week coverage ([utilization.md](./utilization.md)). Still unbuilt: reconciliation
  as a *workflow* (re-forecasting, flagging a role whose actuals have diverged, anything that
  writes back) — the planner grid itself still measures only against itself.
- **A real per-person capacity model is still missing.** The meter's denominator is a flat
  8h/day, 40h/week for everyone: `staff_employment.utilizationTarget` is unusable as-is
  (non-billable ⇒ 0), and part-time contracts, `staff.joinDate`/`terminationDate` and
  holiday calendars are all unmodelled. Every one of those makes the meter read
  optimistically.
- **No rollup, no sort, no filter on capacity *in the planner*.** Over-allocation is visible
  per cell only; nothing in the grid answers "who is oversold this quarter", and the row sort
  still keys off `latestConfirmedEnd` (soonest-to-free), not the meter. **Partially answered
  elsewhere:** the home dashboard's availability panel names who is ≥50% free in each of the
  next **five** weeks (`AVAILABILITY_WEEKS`), and its staffing panel gives a staffed-vs-bench
  headcount for today — but neither reaches "September", and neither writes back.
- **Planned figures for a past range aren't historically faithful** — `project_roles` is mutable
  with no history ([ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md)), so
  last quarter's report reflects the plan as it stands *now*. This is the strongest argument yet
  for history-as-rows here.
