# Utilization report

## Context

Utilization is the one number this platform has always described but never computed.
`docs/data-model.md:114` defines it ("billable hours ÷ available hours for a Person
over a period"), `docs/domains/timesheets.md:271` lists it under *not built*, and
`docs/domains/allocations.md` names plan-vs-actual reconciliation as an open question.
Every input already exists — `project_roles` (the plan), `time_entries` (the actuals),
`staff_pto` (leave), `staff_employment` (who is billable, in which line of business,
full-time or hourly) — but nothing joins them.

This adds a single read-only report at `/dashboards/utilization` that does the join:
a line-of-business filter, a date range, a forecast toggle, and seven metric blocks
covering headcount, roles, bench, PTO, utilization, per-person breakdown, and
line-of-business alignment.

### Decisions taken (from clarification)

| Question | Decision |
|---|---|
| Forecast probability tiers | **Ignored for now.** There is no probability field in the schema. The toggle simply includes `tentative` roles at full weight on top of `confirmed`. The weight lives in one constant so 90/60/30 tiers can land later without touching the math. |
| Plan vs actuals | **Both, everywhere.** Every hours-bearing card carries two series side by side — **Planned** from `project_roles` (the allocations plan) and **Confirmed** from `time_entries` (what people logged on their timesheets). They are never summed, and neither is derived from the other; the gap between them is the point of the report. See *Dual series* below. |
| Page access | **Signed-in only**, like `/allocations`. See the RBAC section — one series is an exception, and it is not a discretionary one. |
| FT / PT | `employment_type` is `FULL_TIME | HOURLY`; **HOURLY reads as part-time**. Only FT staff have an available-hours denominator (hourly staff have no fixed capacity), matching how the spec words the Bench and Utilization cards. |

## RBAC — read this before building

The page itself is ungated as chosen. Three of the four data series are genuinely
open already; **one is not**, and shipping it openly would break an existing boundary.

- **Planned hours, roles, headcount, LOB alignment** — open. `getAllocationsGrid`
  (`src/actions/allocations/getAllocationsGrid.ts`) already ships every active
  person's staffed role spans, `hoursPerDay`, line of business, role and employment
  type to every signed-in user. This report re-aggregates data the planner already
  discloses. No new exposure.
- **PTO day counts** — open. That same read already ships every approved PTO
  `startDate`/`endDate` openly; a day count is a sum of what is already on the wire.
  **Leave `type` must stay out of this report entirely** — it is the one PTO field
  `getAllocationsGrid` withholds behind `pto.review`, and the PTO card has no need
  for it. Do not add a by-leave-type breakdown.
- **Actual hours from `time_entries` — gated on `timesheets.edit` (manager, admin).**
  Today no signed-in user can read another person's logged hours: `getTimesheetList`
  and `getTimesheet` both early-return empty when `staffId !== ownStaffId` unless the
  caller holds `timesheets.edit`, and both pages hard-code `getCurrentStaffId()`.
  A cross-person actuals column would be the **first** disclosure of that data, so it
  is withheld **in the read** (`null`, never serialised) for viewers without the
  capability — the same shape `getAllocationsGrid` uses for `allocationNotes`. Every
  viewer still sees their **own** actuals row.

  If the actuals series should reach a wider audience (delivery-manager and finance
  hold no `timesheets` capability at all today), the honest fix is a new
  `timesheets.view` key added to `permissions.ts`, `src/lib/auth/permissions.test.ts`
  and `docs/domains/permissions.md` **in lockstep** — not a bypass here. Flag it and
  ask rather than widening the gate silently.

Nothing in this report is compensation-derived, so no `staff.viewCompensation` /
`projects.viewMargin` involvement. Do **not** reach for `staffHourlyCost.ts`.

## Computation model

Define these once, in the pure lib, and document them in the module docstring — the
report is only trustworthy if the definitions are stated.

- **Working day** — Mon–Fri, via the existing `isWeekend` / `eachDay`
  (`src/lib/timesheets/timesheet-week.ts`). No statutory-holiday calendar and no
  half-days, consistent with `countWorkingDays` (`src/lib/staff/pto-working-days.ts`).
- **Employment window** — a person contributes to a day only if
  `joinDate <= day` (when set) and `terminationDate >= day` (when set). This is what
  "available hours adjusted for join/termination" means.
- **Available hours (FT only)** — `working days in range ∩ employment window × 8`.
  Hourly staff get no denominator; they appear in project-hours totals and in the
  staff breakdown with a blank utilization %.
- **Per-day plan split — PTO wins.** For each FT working day in the window:
  - on approved PTO → `8` PTO hours, `0` project, `0` bench;
  - otherwise → `projectHours = Σ hoursPerDay` of the included roles covering the day,
    and `benchHours = max(0, 8 - projectHours)`.

  This makes project + PTO + bench equal available hours except when a person is
  over-allocated, where project hours exceed 8 and utilization reads **over 100%**.
  That is deliberate and useful: the allocations planner explicitly does *not* sum a
  person's load across projects (an open question in `docs/domains/allocations.md`),
  so this report is the first surface that surfaces over-allocation. Do not clamp it.
- **Bench day** — an FT *billable* working day inside the employment window with no
  included role and no approved PTO. Streaks are consecutive **working** days
  (a weekend does not break a streak; a PTO day does not count as bench but does
  break the streak).
- **Which roles count** — `confirmed` always; `tentative` additionally when the
  forecast toggle is on. `paused`/`cancelled` never, matching `getAllocationsGrid`.
  Per the spec the toggle affects **only** the Utilization card and the Staff
  Breakdown table; Roles, Bench and LOB Alignment are confirmed-only. Say so in the
  toggle's helper text so the scope isn't a surprise.
- **Confirmed hours** — sum `time_entries.hours` for entries whose `date` falls in the
  range, bucketed by the `projectId` XOR `category` constraint into project / PTO /
  bench (`UNALLOCATED_BENCH`) / internal-admin. The `PTO` *category* is unrelated to
  the `staff_pto` table (one-way prefill only) — never add the two together.

  **Only entries on `submitted` timesheets count as confirmed.** A `draft` week is
  still being edited, so counting it would make the number move under the reader.
  Because a timesheet row is created lazily, a week with no row is "not started", not
  zero — so every hours card also reports **coverage**: how many of the person's
  in-range weeks are submitted. Without that, a low confirmed number is
  indistinguishable from an unsubmitted one. This is a judgement call on "confirmed
  through timesheets"; if drafts should count, it is a one-line change to the read's
  `where` and the coverage line becomes decoration.

### Dual series

Both series are first-class on every card that carries hours. Planned answers *what
we staffed*; Confirmed answers *what people logged*. Render them as adjacent columns
(or paired rows in the split table), always labelled, plus a **variance** column
(`confirmed − planned`, and the same as a %) — the variance is the reason to put them
side by side rather than on two pages.

| Card | Planned (`project_roles`) | Confirmed (`time_entries`) |
|---|---|---|
| Headcount | — (roster facts, single series) | — |
| Roles | active roles, started/ended, avg length, avg roles/project, unique projects | unique projects with logged time in range |
| Bench | days with no role and no PTO; streaks | `UNALLOCATED_BENCH` hours |
| PTO | `staff_pto` days, avg/max record length, took vs didn't | `PTO`-category hours |
| Utilization | project / PTO / bench hours + % of available | project / PTO / bench / internal-admin hours + % of available |
| Staff Breakdown | planned hours + planned util % | confirmed hours + confirmed util %, + variance |
| LOB Alignment | day allocation by role LOB | logged hours by LOB (see attribution below) |

**Attributing confirmed hours to a line of business.** `projects` has no
`lineOfBusiness` column — a project's LOB is derived from its roles
(`src/lib/projects/project-derived.ts`). So attribute a time entry to the LOB of
*that person's* role on *that project* covering the entry's date; if the person has no
matching role (they logged against a project they were never staffed to), fall back to
their home LOB. Note this fallback in the card's caption — it is the one place the two
series can legitimately disagree on LOB for the same day.

**Consequence of the actuals gate:** for a viewer without `timesheets.edit`, the
Confirmed column collapses to their own row only, and the variance column with it.
Render that as an explicit "Confirmed hours require timesheet access" note rather than
blank cells, so the report doesn't read as broken.
- **Cohort and the LOB filter** — the cohort is people whose **home** line of business
  (`staff_employment.lineOfBusiness`) matches the filter. That is what makes LOB
  Alignment meaningful: a CORE person's days can land in FINTECH via their role's LOB.
- **Effective dating** — resolve each person's employment facts as of the **range end**
  using `latestEmploymentFirst` + `firstPerKey`, the fold `getAllocationsGrid` and
  `getCompensationSummaryData` already use. (`employmentAsOf` in
  `src/lib/staff/bonus-attribution.ts` is the per-date variant if a day-level
  attribution is ever wanted — not needed for v1.)

## Files

### New — pure math (client-importable, no `db`, no React)

`src/lib/utilization/utilization-report.ts` — a new domain folder; the report spans
allocations + PTO + timesheets and belongs to none of them. Exports the row/summary
types plus one builder per card, all pure functions over the read's payload:

- `UtilizationInputs` (staff, roles, pto, entries, weekCoverage, range,
  includeTentative)
- `buildHeadcount`, `buildRoleStats`, `buildBenchStats`, `buildPtoStats`,
  `buildUtilizationSplit`, `buildStaffBreakdown`, `buildLobAlignment`
- a shared `HoursSeries` type (`{ planned, confirmed, variance }`) that every
  hours-bearing builder returns, so the two series can't drift in shape card to card
- `HOURS_PER_DAY` / `TENTATIVE_WEIGHT` constants (import `WORKING_DAYS_PER_WEEK`
  from `@/lib/allocations/allocations-grid` rather than redefining it)

`confirmed` is `null` — not `0` — wherever the viewer lacks access to a person's
entries, so "no access" and "logged nothing" stay distinguishable all the way to the
render. That distinction is easy to lose in a `?? 0` and it silently fabricates zeros.

`src/lib/utilization/utilization-report.test.ts` — `bun test`. ADR 0037 says don't
reflexively add unit tests, but explicitly allows a small deliberate set where
correctness is beyond the type checker; this math qualifies. Cover: PTO-beats-project
precedence, over-allocation reading >100%, bench streaks spanning a weekend, the
join/termination window trimming available hours, tentative in/out of the toggle,
and LOB alignment summing to 100%.

### New — the read

`src/actions/utilization/getUtilizationReport.ts` — `import "server-only"`, named
export `getUtilizationReport({ start, end })`, returns an exported
`UtilizationReportData`. A **projection, not a calculator** — the math is the lib's job.

Queries (flat, no N+1, explicit columns only — model on `getAllocationsGrid`):
1. active `staff` (`id, name, joinDate, terminationDate`)
2. `staffEmployment` ordered by `latestEmploymentFirst` → `firstPerKey`
   (`lineOfBusiness, role, employmentType, isBillable`)
3. `projectRoles` ⋈ `projects`, `staffId IS NOT NULL`,
   `status IN ('tentative','confirmed')`, overlapping the range
4. `staffPto` where `isPending = false`, overlapping the range
5. `min(startDate)` per `staffId` over confirmed roles — the joiner
   "days to first placement" metric needs the first role even when it falls outside
   the range, so it cannot come from query 3
6. `timeEntries` ⋈ `timesheets` for dates in range, `timesheets.status = 'submitted'`,
   projecting `staffId, date, projectId, category, hours` — **only when the viewer
   holds `timesheets.edit`; otherwise scoped to `ownStaffId`**
   (`src/actions/staff/ownStaffId.ts`)
7. submitted-week coverage: `timesheets` rows (`staffId, weekStartDate, status`) for
   the weeks the range spans (`eachWeek` from `@/lib/timesheets/timesheet-week`),
   under the same scoping as query 6 — this is what turns a low confirmed number into
   "3 of 4 weeks submitted" instead of a silent understatement

Return `canViewAllActuals: boolean` alongside the data so the client renders
affordances without re-deriving permissions.

Also export `utilizationFilterOptions = STAFF_FILTER_OPTIONS`
(`src/lib/staff/staff-filters.ts`) so the page never imports the Drizzle schema.

### New — the page

`src/app/(app)/dashboards/utilization/page.tsx` — async Server Component:
`export const metadata`, read `searchParams` for `start`/`end` (defaulting to the
current month via `currentMonthStart` + `addMonths`/`addDays`), `await` the read,
render the title block inside `mx-auto flex max-w-6xl flex-col gap-6` — wider than
the `max-w-5xl` dashboards because of the staff table.

The range lives in the **URL** (the bonus dashboard's `year` param in
`src/app/(app)/dashboards/bonuses/page.tsx` is the precedent) because it bounds the
server query and a report link should be shareable. The LOB filter and forecast
toggle are **client `useState`**, filtered in `useMemo`, matching every other
dashboard — neither changes what must be fetched.

### New — the components

`src/components/utilization/utilization-report.tsx` — `"use client"`, owns filter
state and the `useMemo` chain, renders the seven blocks below it.
Sibling card components (`headcount-card.tsx`, `bench-card.tsx`, …) keep the file
sizes sane. Reuse:

- `StatCard` (`src/components/performance/stat-card.tsx`) for every KPI tile, in
  `grid gap-4 sm:grid-cols-3` rows
- `SegmentedFilter` + `FilterLabel` + `ALL` (`src/components/form/filters.tsx`) for
  the LOB filter — **not** `DashboardFilterBar`, whose three fixed dimensions and
  currency toggle don't fit here
- shadcn `Table` primitives directly with `<TableFooter>` totals rows, as every
  analytics table in the app does (`compensation-dashboard.tsx` is the model);
  numbers get `text-right tabular-nums`, wrappers `overflow-x-auto rounded-md border`
- `EmptyState` (`src/components/empty-state.tsx`) for empty cohorts
- `Switch` for the forecast toggle
- `formatPercent` / `formatDateRange` (`src/lib/format/format.ts`)

No charts. `docs/ui.md` forbids adding a charting dependency; if a visual is wanted
later it must be a hand-rolled inline `<svg>` following
`level-distribution-bar-chart.tsx`. Not in scope here — the spec is cards and tables.

### Changed

- `src/components/allocations/planner-range.tsx` — extract the private
  `EndpointPicker` into `src/components/form/endpoint-picker.tsx` and import it back.
  The report needs the same bounded two-popover date range but has no `Granularity`,
  which `PlannerRange` is coupled to. Extract the shared half rather than duplicating
  or forcing a fake granularity. `PlannerRange`'s own behaviour must not change.
- `src/components/app-shell/nav.ts` — add `{ title: "Utilization", href:
  "/dashboards/utilization" }` to the existing `Dashboards` `children`. Note the
  parent entry carries `permission: { staff: ["viewCompensation"] }`, which would
  hide an open page from most users — the child needs the parent to be reachable, so
  **loosen the parent's gate and move `staff.viewCompensation` onto the Compensation
  and Bonuses children**, leaving Utilization open. Verify against
  `src/app/(app)/dashboards/page.tsx`, which is a permission-aware redirect chain and
  must gain a branch that lands an unprivileged user on `/dashboards/utilization`.
- `docs/` — dispatch the `librarian` subagent afterwards. This touches
  `docs/domains/timesheets.md` and `docs/domains/allocations.md` (both list
  utilization as unbuilt), `docs/data-model.md`, and `AGENTS.md`'s status paragraph.
  It also warrants an **ADR** recording the computation model above — the PTO-wins
  precedence, uncapped over-allocation, the two series never being summed,
  submitted-only confirmed hours plus the coverage line, the role-then-home-LOB
  attribution for logged hours, and the `timesheets.edit` gate on the confirmed
  series are exactly the non-obvious choices ADRs exist for.

No seed changes are needed. `scripts/seed/timesheets.ts` already gives a subset of
staff ~80%-submitted weeks with the current week left as a draft, and it assigns
entries to **randomly chosen projects** — so the seeded data naturally exercises the
draft-coverage line, the "logged against a project I was never staffed to" LOB
fallback, and people with planned hours but no timesheet at all.

## Verification

1. `bun run check` — Biome + `tsc --noEmit` + `bun test`, including the new
   utilization math tests and the untouched permission matrix test.
2. `bun run build`.
3. `bun run db:seed` then `bun run dev`, and against the seeded data confirm:
   - default range is the current month; changing either endpoint updates the URL and
     the numbers, and the link is reloadable
   - the LOB filter narrows every card, and LOB Alignment percentages still total 100%
   - the forecast toggle changes only the Utilization card and Staff Breakdown
   - a person with a role and PTO on the same day shows PTO, not project hours
   - a person on two overlapping full-time roles reads over 100%
   - Staff Breakdown available hours shrink for someone whose `joinDate` falls
     mid-range
   - **every hours card shows both series** — Planned and Confirmed are both populated,
     differ from each other, and produce a non-zero variance
   - a person whose in-range weeks are all `draft` shows planned hours against zero
     confirmed, with the coverage line explaining it rather than a bare `0`
   - a time entry against a project the person was never staffed to lands in their
     home LOB in LOB Alignment
4. **RBAC, manually, as two users** — sign in as a `user`-role account and confirm the
   actuals column is absent and no actual-hours value for another person appears in
   the serialised RSC payload (check the network response, not just the DOM); confirm
   own-row actuals still render. Then confirm a `manager` sees the full column.
5. Run `/audit-rbac` and `/code-review`, and address what they find, before merging.

## Out of scope

Probability-weighted forecast tiers (no data to weight with), any money/margin on the
report, timesheet approval, and reconstructing a *past* plan — `project_roles` is
mutable with no history (a deliberate exception to the history-as-rows pattern), so
planned utilization for a past range reflects the plan as it stands **now**, not as it
stood then. Worth a caption on the Utilization card.
