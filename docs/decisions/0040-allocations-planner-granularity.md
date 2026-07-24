# 0040 — Allocations planner: selectable day/week/month granularity

**Status:** accepted · 2026-07-24

## Context

The `/allocations` planner ([ADR 0038](./0038-allocations-planner-pto-disclosure.md))
shipped as a **weekly-only** grid: rows = staff, columns = ISO weeks, each cell a
prorated share of a 40-hour week. Weeks are the right zoom for near-term staffing, but
they're the wrong zoom at both ends — you can't see *which day* a role starts within a
week, and a 6-month capacity outlook becomes 26 cramped columns. The planner needed to
zoom without becoming a second surface.

## Decision

**Add a "View by" toggle with three column granularities — Day / Week (default) /
Month — over the same read.** No schema change; still a pure view over `project_roles`
+ `staff`/`staff_employment` + `staff_pto`.

- **A cell shows the role's *nominal rate* at every granularity** — `hoursPerDay / 8h`,
  capped at 100 (4h/day → 50%, 8h/day → 100%). The granularity changes **column width
  and how the start/end edges land**, not the headline number. This keeps the grid
  legible: a person at 50% reads "50%" whether you're looking at days, weeks, or months.
- **Week keeps its historical proration; day and month do not.** `bucketPercent`
  dispatches on granularity:
  - **Week** — prorates partial start/end columns via `weekPercent` (`hoursPerDay ×
    active Mon–Fri weekdays / 40`), unchanged, so a mid-week edge shows a partial %.
  - **Day** — one column per calendar day; **all 7 render, weekends dimmed and empty**
    (the model only counts weekdays); an in-range weekday shows the flat nominal rate.
  - **Month** — one column per calendar month; the **flat nominal rate for any month
    the role touches**, *not* scaled by working-days-covered. The month containing the
    start/end date carries the edge marker.
- **Time off *is* prorated over the bucket's working days at every granularity** (away
  weekdays / total weekdays in the column) — a day is 100% when covered, a week /5, a
  month /working-days-in-month. Availability is a real fraction; a role's plan is a
  rate.
- **Default windows re-seed on granularity change.** 14 days / 12 weeks / 6 months
  (`DEFAULT_WINDOW`), anchored at today; switching granularity resets the range to that
  window (a leftover week range is meaningless as days). Prev/next shift the window by
  one bucket of the active granularity.
- **The date math stayed library-free.** `timesheet-week.ts` gained `addDays`,
  `getMonthStart`, `addMonths`, `eachDay`, `eachMonth`, `currentDay`,
  `currentMonthStart` — string-based local-parts arithmetic, consistent with the
  existing week helpers. No date library was introduced.

## Consequences

- The **week-vs-month proration inconsistency is deliberate**, and the sharpest
  non-obvious edge here: weeks show a prorated partial %, months show the flat rate.
  Rationale — a month is a *capacity outlook* zoom where "is this person committed at
  50% this month?" is the question, and prorating by working-days-in-month would make a
  role that spans 3 of 4 weeks read as some odd fraction that means neither "their rate"
  nor "their hours." Weeks stay prorated because that's the near-term planning zoom
  where partial-week edges matter. If this ever confuses users, month proration is the
  knob to revisit.
- **`weekPercent` remains the single source for a week's load**, still imported by the
  opportunity planner (`project-planner-grid.ts`, weekly-only). Keep both call sites in
  step if the weekly formula changes.
- The multi-granularity move **renamed the grid types**: `WeekCell` → `BucketCell`,
  `AllocationRow.weeks` → `AllocationRow.cells`; `buildAllocationRows` gained `columns`
  + `granularity` params. Purely internal to the allocations lib + its components.
- Still a *view*, not the capacity model — it doesn't sum a person's cross-project load
  or flag over-allocation at any granularity (see the open questions in
  [domains/allocations.md](../domains/allocations.md)).

## Alternatives considered

- **Prorate months by working-days-covered (like weeks).** Rejected — see Consequences;
  a month is a rate-outlook zoom, and a "37%" month reads as noise, not capacity.
- **Quarter / year granularities too.** Deferred — day/week/month covers the useful
  range; more buckets add toggle clutter without a clear planning use yet.
- **A separate long-range view instead of a toggle.** Rejected — same data, same read,
  same interactions; a granularity toggle is far cheaper than a second surface to keep
  in step (the lesson from the opportunities board-vs-list split,
  [ADR 0039](./0039-opportunities-list-view-and-board-column-capping.md)).
