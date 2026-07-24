# Allocations planner

## Context

The PSA platform has CRM, projects, staff, timesheets, and peer-feedback built, but
**allocations** is only partially realized: `project_roles` already models "a person
allocated to a project-role over a date range, at N hours/day, tentative or confirmed"
(the first concrete cut of the Allocation entity, per ADR 0017), yet there is **no
company-wide view** of who is staffed on what, when. `docs/domains/allocations.md`
lists a full planner as proposed-but-unbuilt.

This adds that view: a read-only **Allocations planner** page on the side nav where the
left column lists active staff and the right columns are consecutive weeks. A cell is
filled when a person is allocated to a project-role during that week, showing the
project name and a percentage of a 40-hour week, with a tooltip (project, role, duration,
status) and a visual distinction between confirmed and tentative roles. Time-off spans
render as a distinct "Away" cell. A filter bar narrows by name, line of business,
full-time/part-time, role, and skills. Anyone signed in can see the page.

**No schema change** — the feature is a new read + UI over existing tables
(`project_roles`, `staff`, `staff_employment`, `staff_pto`). So no `db:generate`,
`db:migrate`, or seed changes are needed.

## Decisions (confirmed with the user)

- **Percentage** = `hoursPerDay × (that role's active Mon–Fri weekdays in the week) / 40`,
  capped at 100 per allocation. Half-day role (4h) over a full week = 50%; a role ending
  Wednesday = 60%. Naturally handles partial weeks and part-time.
- **Week window** = a **date-range picker** at the top (two `DatePicker`s: start + end).
  Default = current week through +11 weeks (12 columns). Columns are `eachWeek(start, end)`.
- **Time off (RBAC-sensitive)** — viewing others' PTO normally requires the manager/admin
  `pto:[review]` capability, but this page is public. Chosen approach: **everyone sees a
  generic "Away" block** (availability only, no reason); **only users with `pto:[review]`
  see the leave *type*** in the tooltip. This treats "is away" as shareable availability
  while keeping the sensitive leave category gated — a deliberate, documented decision, not
  a loosening of the gate. Only **approved** PTO (`isPending = false`) is shown.
- **Rows** = all **active** staff (`staff.isActive`), including those with no allocations
  in the window (empty row = available capacity — the whole point of a planner). Placeholder
  (unstaffed) `project_roles` are **excluded** — this is a staff-centric view.

## Approach

Model the new code on the existing **opportunity planner** (`planner-grid.tsx` +
`src/lib/projects/project-planner-grid.ts`) and the **staff directory** filter bar
(`staff-directory.tsx` + `src/components/form/filters.tsx`), reusing the week-math in
`src/lib/timesheets/timesheet-week.ts`. The existing `PlannerGrid` can't be reused
directly (its cells are bare colored blocks with no project name/percentage, and it only
rows people who have roles), so we build a **new but closely-modeled** grid + pure
grid-math pair.

### 1. Read — `src/actions/allocations/getAllocationsGrid.ts` (new, `server-only`)

Follows the read convention (`import "server-only"`, plain async fn, explicit columns,
exported return type; **no `metadata` gate** — auth is guaranteed by the `(app)` layout,
and project-role reads are open by design). Mirrors `getStaffDirectory.ts` for the
staff + latest-employment shape.

- Fetch **active staff** (`staff` + latest `staff_employment` via `latestEmploymentFirst` /
  `firstPerKey`, like `getStaffDirectory`) → identity, `lineOfBusiness`, `role`,
  `employmentType`, `skills`. Filter to `isActive = true`.
- Fetch **staffed `project_roles`** (`staffId` not null) joined to `projects` (+ `companies`
  for context if wanted) → `staffId`, `projectId`, project `name`, `roleType`, `status`,
  `lineOfBusiness`, `startDate`, `endDate`, `hoursPerDay`, `description`.
- Fetch **approved PTO** (`staff_pto` where `isPending = false`) → `staffId`, `startDate`,
  `endDate`, and `type`. Resolve the current user (`getCurrentUser`) and, only if
  `userHasPermission(user, { pto: ["review"] })`, keep `type`; otherwise **null it out**
  before returning. Carry an explicit justification comment here (per the permissions rule
  for intentionally-public-but-sensitive reads).
- Export filter option lists (`lineOfBusiness`, `role`, `employmentType`) the same way
  `staffDirectoryFilterOptions` does (reuse `STAFF_FILTER_OPTIONS`), so the page passes
  them as props without importing the schema.
- Return raw spans (not week-bucketed) — bucketing is pure client math (below), keeping the
  read simple and the math unit-testable/client-importable.

### 2. Grid math — `src/lib/allocations/allocations-grid.ts` (new, pure, client-importable)

Mirrors `project-planner-grid.ts` (no `db`/React). Uses `eachWeek`, `getWeekStart`,
`getWeekDays`, `isWeekend`, `addWeeks`, `currentWeekStart` from `timesheet-week.ts` and
`weekColumnLabel`-style formatting via `parseIsoDate`.

- `defaultWindow()` → `{ start: currentWeekStart(), end: addWeeks(currentWeekStart(), 11) }`.
- `buildWeekColumns(start, end)` → `eachWeek(start, end)`.
- `weekPercent(role, weekStart)` → count that role's active weekdays in the week
  (`getWeekDays(weekStart)` ∩ `[roleStart, roleEnd]`, excluding weekends), then
  `min(100, round(hoursPerDay × weekdays / 40 × 100))`.
- `buildAllocationRows(staff, roles, pto, weekColumns)` → one `AllocationRow` per staff
  (sorted by name), each with a `WeekCell[]` aligned to `weekColumns`. A `WeekCell` holds
  `allocations: AllocationCell[]` (project name, roleType, status, lineOfBusiness, start/end,
  percent) and `timeOff: { away: true; type: PtoType | null } | null`.
- Export the `AllocationRow` / `WeekCell` / `AllocationCell` types.

### 3. Grid component — `src/components/allocations/allocations-grid.tsx` (new, `"use client"`)

Structurally copies `planner-grid.tsx`: the same hand-rolled `<table>` with a
`sticky left-0 z-10 min-w-56 bg-background` first column, `min-w-*` week columns, and the
`overflow-x-auto rounded-md border` wrapper. Per cell:

- Stack one small block per allocation (multiple projects in a week stack vertically),
  each showing the **project name** (truncated) + **percentage**.
- **Confirmed vs tentative** styling reusing the existing convention: confirmed =
  `bg-foreground/25` (solid), tentative = lighter/hatched (e.g. `bg-foreground/10` with a
  dashed border) — visually distinct. A small legend (like `PlannerLegend`).
- **Tooltip** via `@/components/ui/tooltip` (`Tooltip`/`TooltipTrigger`/`TooltipContent`;
  provider already mounted) with project name, role name (`PROJECT_ROLE_TYPE_LABELS`),
  duration (start–end), and status (`PROJECT_ROLE_STATUS_LABELS`). Rich content → use the
  Tooltip component, not a bare `title=`.
- **Time-off** cell: a distinct neutral "Away" block; tooltip shows the PTO type only when
  present (managers), else just "Time off".

### 4. Planner container — `src/components/allocations/allocations-planner.tsx` (new, `"use client"`)

Owns filter + window state and renders the grid. Reuses the staff-directory filter pattern
verbatim: `useState` per filter + one `useMemo` filtering the rows in-memory (no URL params).

- Filters: name `Input type="search"` with `IconSearch`; `SelectFilter` for line of business
  and role; `SegmentedFilter` for full-time/part-time (`EMPLOYMENT_TYPE_LABELS`); the
  `SkillsFilter` Combobox pattern + `matchesSkillFilter` for skills. `ALL` sentinel = no
  filter. Label maps: `LINE_OF_BUSINESS_LABELS`, `ROLE_LABELS`, `EMPLOYMENT_TYPE_LABELS`.
- Window: two `DatePicker`s (start/end) defaulting to `defaultWindow()`; recompute
  `weekColumns` and rows via `useMemo` on change.

### 5. Page — `src/app/(app)/allocations/page.tsx` (new, server component)

`export const metadata = { title: "Allocations" }`; `await getAllocationsGrid()` directly;
render `<AllocationsPlanner ... />` with data + filter options as props. Use a **wide**
wrapper (e.g. `mx-auto flex w-full flex-col gap-6`, not the `max-w-5xl` of narrow pages)
since the grid scrolls horizontally; keep the in-page `<header><h2 class="font-heading …">`
title convention.

### 6. Nav — `src/components/app-shell/nav.ts` (edit)

Add one entry to `NAV_ITEMS`, **no `permission`** (visible to everyone). Import a fitting
Tabler icon not already in use here (e.g. `IconCalendarStats` or `IconLayoutGrid`):

```ts
{ title: "Allocations", href: "/allocations", icon: IconCalendarStats }
```

Place it near Projects/Timesheets (it bridges staffing and delivery).

### 7. Docs — dispatch the `librarian` subagent afterward

Reconcile `docs/domains/allocations.md` (planner view now realized), `docs/data-model.md`,
and add/adjust an ADR note if the PTO-visibility decision warrants one. Do not hand-write
`/docs` from the main session.

## Files

**New**
- `src/actions/allocations/getAllocationsGrid.ts`
- `src/lib/allocations/allocations-grid.ts`
- `src/components/allocations/allocations-grid.tsx`
- `src/components/allocations/allocations-planner.tsx`
- `src/app/(app)/allocations/page.tsx`

**Edit**
- `src/components/app-shell/nav.ts`

## Verification

- `bun run check` (Biome + `tsc --noEmit` + tests) — must pass, incl. the RBAC matrix test.
- `bun run build` — production build / type-check.
- Manual (via the `run` skill / `bun run dev`), signed in:
  - Nav shows **Allocations**; page loads for a normal (non-manager) user.
  - Rows list active staff; a person on a confirmed role shows the project name + a correct
    %, distinct from a tentative role; multiple projects in one week stack.
  - Percentage sanity: full-week 8h/day role = 100%; 4h/day = 50%; role ending mid-week
    scales down.
  - Tooltip shows project, role, duration, status.
  - Time off shows a generic **Away** block; leave **type** appears in the tooltip only for a
    `pto:[review]` user (manager/admin) and is hidden for others.
  - Filters (name, line of business, type, role, skills) narrow the rows; the date-range
    picker changes the week columns.
- Confirm no schema drift: no new migration, seed still green under `bun run check`.
```
