# Timesheets: searchable add-project dialog + PTO / allocation prefill

## Context

The per-week timesheet editor (`src/components/timesheets/timesheet-week.tsx`) currently exposes a single inline `Select` — "Add a project or category…" — that lists *all* projects flat, with no search and no awareness of what the person is actually staffed on. Filling a week means hunting through the whole project list and typing every day's hours by hand, even though the app already knows the person's planned allocations and approved PTO for that week.

This change makes starting a timesheet fast and low-friction:

1. **Replace the project selector with an "Add project" button that opens a searchable dialog.** The dialog surfaces the projects the person is *allocated to that week* first (as suggestions), but keeps every project searchable — logging against any project stays allowed (a resolved design decision, see `docs/domains/timesheets.md`). Non-billable categories (PTO, Unallocated bench, Internal admin) move into the same dialog so it remains the single entry point for adding a row.
2. **Add two prefill buttons above the grid — "Fill in PTO" and "Fill in allocations"** — that populate the draft from the person's approved PTO and planned allocations for that week. These are **manual, opt-in** buttons (not auto-fill), available whenever the sheet is an editable draft.

All writes still flow through the existing whole-week `saveTimesheet` replace; prefill and dialog changes are purely client grid-state operations plus one new read. No schema changes.

## Decisions (confirmed with user)

- Prefill is **manual buttons only** — nothing auto-fills on open.
- Non-billable categories live **inside the Add-project dialog** (a section below the project suggestions), not a separate control.
- "Fill in allocations" uses the person's **actual planned `hoursPerDay`** from `project_roles`, prorated to the days the allocation is active that week — not fill-to-8h.

## Data source facts (from exploration)

- An "allocation" is a staffed `project_roles` row: `staffId`, `projectId`, `status ∈ {tentative,confirmed}`, `startDate`/`endDate` (date spans), `hoursPerDay` (`numeric(4,2)`, default 8). No percentage column. `src/lib/db/projects-schema.ts:94`.
- PTO is `staff_pto` date spans (`isPending=false` = approved); **no per-day hours** — assume a full working day (8h) per weekday off. `src/lib/db/staff-schema.ts:181`. Do **not** expose PTO `type` (that's gated behind `pto:["review"]`) — we only need the dates.
- Query shape to reuse (span-overlap + status filter): `getAllocationsGrid.ts:119-166`.
- Week math helpers (pure, no db): `getWeekDays`, `isWeekend` in `src/lib/timesheets/timesheet-week.ts`.
- Grid targets are namespaced values: `PROJECT_PREFIX`/`CATEGORY_PREFIX`, `targetKey()`, and the load-bearing `addTarget()` in `timesheet-week.tsx:154`. Category `"PTO"` is a `TIMESHEET_CATEGORY` value (`src/lib/timesheets/timesheet-category.ts`).
- Save constraints prefill must respect: weekday-only (weekends rejected), 8h/day total cap (`DAILY_HOUR_CAP`), one row per `(date, target)`, project XOR category — `saveTimesheet.schema.ts`.

## Changes

### 1. New read — `src/actions/timesheets/getTimesheetPrefill.ts` (server-only)

Follows the reads pattern (`import "server-only"`, plain async fn, self-scoped). Signature:

```ts
getTimesheetPrefill(staffId: string, weekStartDate: string): Promise<TimesheetPrefill>
```

Returns:
```ts
type AllocatedProject = {
  projectId: string;
  name: string;
  companyName: string;
  hoursByDate: Record<string, number>; // weekday ISO date -> hours
};
type TimesheetPrefill = {
  allocations: AllocatedProject[];
  ptoHoursByDate: Record<string, number>; // weekday ISO date -> 8
};
```

- **Auth / scoping:** mirror `getTimesheet` — resolve `getCurrentUser`; if `staffId` isn't the caller's own staff record and the caller lacks `timesheets.edit`, return an empty prefill (`{ allocations: [], ptoHoursByDate: {} }`). Never return another user's data unguarded. Only reads the person's own allocations/PTO; **PTO `type` is never selected or returned**, so no `pto:["review"]` concern.
- **Allocations query:** `project_roles ⋈ projects ⋈ companies` where `staffId = X`, `status IN ('tentative','confirmed')`, and span overlaps the week (`startDate <= weekEnd AND endDate >= weekStart`). Group by `projectId`; for each weekday in the week that is within a role's `[startDate,endDate]` and not a weekend, set hours to that role's `hoursPerDay`. If multiple roles map to the same project on the same day, sum, then clamp each day to `DAILY_HOUR_CAP`.
- **PTO query:** `staff_pto` where `staffId = X`, `isPending = false`, span overlaps the week; for each non-weekend weekday within a span, set 8h.

### 2. Pure grid helpers — `src/lib/timesheets/timesheet-grid.ts`

Add alongside `autofillProjectHours` (keep that; it still backs the dialog's plain "add project" click for a non-allocated project):

- `applyAllocationFill(rows, allocations, weekDays): Row[]` — for each `AllocatedProject`, upsert its project `Row`; fill `hoursByDate` **only into currently-empty weekday cells** (never clobber user-entered hours), respecting the per-day 8h total across existing rows.
- `applyPtoFill(rows, ptoHoursByDate, weekDays): Row[]` — upsert the `"PTO"` category `Row` and fill empty weekday cells the same way.

Both reuse `targetKey`, `parseHours`, and the `Row` shape. Keep them pure/React-free so they unit-test in isolation.

### 3. New component — `src/components/timesheets/add-project-dialog.tsx` (client)

A `Dialog` (from `@/components/ui/dialog`) triggered by an "Add project" `Button` (`IconPlus`). Body = a search `Input` + a filtered, grouped, scrollable list of selectable rows:

- **"Allocated to you"** — allocated projects (from `prefill.allocations`) not already on the grid, shown first as suggestions.
- **"All projects"** — the rest of `projects` (the full `SelectableProject[]`).
- **"Non-billable"** — the `TIMESHEET_CATEGORY` buckets not already used.

Client-side filter on the search text (the project list is small and already loaded — no server search needed, unlike `entity-combobox.tsx`). Selecting a row calls a passed `onSelect(value)` with the namespaced `PROJECT_PREFIX`/`CATEGORY_PREFIX` value and closes the dialog — reusing the existing `addTarget` logic unchanged. Filter out already-used targets via the `usedKeys` set the parent already computes.

### 4. Wire the grid — `src/components/timesheets/timesheet-week.tsx`

- New props: `prefill: TimesheetPrefill`.
- **Add a toolbar row *above* the grid** (only when `editable`) holding three buttons: **Add project** (opens `AddProjectDialog`), **Fill in PTO**, **Fill in allocations**.
  - Fill buttons call `setRows(prev => applyPtoFill(...))` / `applyAllocationFill(...)`.
  - Disable "Fill in PTO" when `prefill.ptoHoursByDate` is empty and "Fill in allocations" when `prefill.allocations` is empty (tooltip: "No approved PTO this week" / "No allocations this week").
- Remove the inline `Select` (and its `availableProjects`/`availableCategories` grouping) from the bottom actions row; the dialog replaces it. **Save draft / Submit / Reopen stay exactly where they are** in the bottom actions row.
- `addTarget` is reused as the dialog's `onSelect`; the `PROJECT_PREFIX`/`autofillProjectHours` behavior for a manually-picked project is preserved.

### 5. Wire the page — `src/app/(app)/timesheets/[week]/page.tsx`

Add `getTimesheetPrefill(staffId, weekStartDate)` to the existing `Promise.all` (`page.tsx:71`) and pass `prefill` to `<TimesheetWeek>`. Keep `getSelectableProjects()` for the full searchable list.

### 6. Tests — `src/lib/timesheets/timesheet-grid.test.ts` (new)

Bun tests for `applyAllocationFill` and `applyPtoFill`: upsert vs. merge into existing row, don't-clobber-user-hours, weekend/empty handling, 8h/day clamp. (There's no grid test file today — this adds the missing coverage the module's own docstring calls for.)

### 7. Docs

After implementation, dispatch the **librarian** subagent to reconcile `docs/domains/timesheets.md` (new prefill affordances, the allocation/PTO-derived suggestions, the dialog replacing the selector) and note the new self-scoped read.

## Out of scope / non-goals

- No change to the save/submit lifecycle, schema, or the whole-week replace semantics.
- No auto-fill on load (explicitly manual).
- No PTO↔`staff_pto` two-way sync — prefill is a one-way convenience; the timesheet PTO bucket stays independent (per the current design).

## Verification

1. `bun run check` (Biome + tsc + tests — includes the new grid tests and the RBAC matrix test) and `bun run build`.
2. `/audit-rbac` — confirm the new `getTimesheetPrefill` read is properly self-scoped and leaks no other user's allocations/PTO and no PTO type.
3. Manual (`bun run dev`, `/timesheets/<a-week>` as a staff user with known allocations + approved PTO that week):
   - "Add project" opens the dialog; allocated projects appear under "Allocated to you" first; search filters; non-billable categories are listed; selecting adds the row and closes.
   - "Fill in allocations" adds the allocated project rows with the planned `hoursPerDay` on the correct weekdays; re-clicking doesn't clobber manually edited cells.
   - "Fill in PTO" adds a PTO row at 8h on the PTO weekdays.
   - Buttons are disabled with a tooltip when there's no PTO / no allocation that week; the whole toolbar is hidden on a submitted (locked) week and for a week outside the edit window.
   - Save draft + Submit still persist correctly and respect the 8h/day cap warning.
