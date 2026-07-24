# Domain: Allocations

**Status: proposed as a full domain — partially realized.** Staffing People onto
Projects over time — the heart of capacity planning. The first concrete cut of the
Allocation entity **already exists** as `project_roles` in the Projects domain (see
[projects.md](./projects.md)), and a **read-only company-wide planner view**
(`/allocations`) now surfaces that data as a weekly grid (see *The planner view*
below). The rest of the domain (a dedicated capacity model, forecast vs. actuals,
conflict handling) is still proposed.

## The planner view (realized) — a read over `project_roles`, not a new table

`/allocations` is a **read-only, company-wide** grid: **rows = active staff**,
**columns = weeks** over a user-chosen date range (default: current week + next 11,
12 columns). It's a **view over existing tables — no schema change**. It reads
`project_roles` (the plan), `staff` + `staff_employment` (who + their current facts),
and `staff_pto` (availability). It is **visible to everyone signed in — no permission
gate** (the same open-read posture as the staff/CRM/projects lists).

- **What a cell shows.** For each person-week, every project the person is allocated
  to that week — project name + a **percentage of a 40-hour week**, with a tooltip
  (project, role, duration, status). **Confirmed** roles render as a solid block,
  **tentative** as a dashed outline. Approved time off renders as a neutral **"Away"**
  strip (availability only).
- **What appears.** Only **staffed** roles (non-null `staffId` — placeholders/open
  positions have no person to row) with status **`tentative` or `confirmed`**;
  `paused`/`cancelled` roles are excluded (not an active allocation). Only **approved**
  (non-pending) PTO is shown.
- **PTO disclosure is minimal, and gated.** Everyone sees the reason-free "Away"
  strip; the leave **type** is revealed only to viewers holding **`pto.review`** —
  `getAllocationsGrid` nulls the `type` field otherwise. This preserves the PTO gate
  rather than loosening it; see [ADR 0038](../decisions/0038-allocations-planner-pto-disclosure.md)
  and [permissions.md](./permissions.md).
- **Filter bar.** Narrows the staff rows in-memory (the once-fetched-list pattern the
  staff directory uses) by name, line of business, employment type, role, and skills.
  The skills multi-select is the shared `src/components/form/skills-filter.tsx`
  (extracted from the staff directory, now used by both).

### Code map

- **Read:** `src/actions/allocations/getAllocationsGrid.ts` (server-only; also
  re-exports `allocationsFilterOptions = STAFF_FILTER_OPTIONS`). Two-query
  latest-employment-per-person fold (no N+1), mirroring `getStaffDirectory`.
- **Pure grid math:** `src/lib/allocations/allocations-grid.ts` — builds the ISO-Monday
  week-column spine, folds staff + roles + PTO into one row per person, and computes
  the per-week percentage: `hoursPerDay × (active Mon–Fri weekdays that week) / 40`,
  rounded and **capped at 100** (a mid-week end date or a part-day, e.g. 4h/day → 50%,
  shows as a partial %). It exports **`weekPercent`** (the per-role, per-week load) and
  `WORKING_DAYS_PER_WEEK`. Client-importable (no `db`/drizzle), reusing the timesheet
  week helpers. **`src/lib/projects/project-planner-grid.ts`** (the opportunity planner's
  grid) now **imports `weekPercent` from here** rather than duplicating the math, so the
  two planners agree on a week's load — keep this the single source and update both call
  sites when the load formula changes.
- **UI:** `src/components/allocations/allocations-planner.tsx` (filter bar + window),
  `allocations-grid.tsx` (render-only grid + legend), page
  `src/app/(app)/allocations/page.tsx`. Nav entry added to `NAV_ITEMS`
  (`src/components/app-shell/nav.ts`), ungated.

> **This is a *view*, not the missing capacity model.** It reads one project's-worth
> of roles per person per week but does **not** sum a person's load across projects,
> flag over-allocation, or reconcile against timesheet actuals — those remain the
> open questions below.

## Purpose

Decide who works on what, when, and how much — and keep the plan reconcilable against availability and actuals.

## Key entities

- **Allocation** — a *time-ranged* assignment of a Person to a Project: start/end dates, capacity (% or hours/week), and project role.
  - **First cut realized as `project_roles`** (`src/lib/db/projects-schema.ts`): a
    staffing line = a `staff` member (or a **placeholder / open position** when `staffId`
    is null) of a given `roleType` (discipline) for a `startDate`/`endDate` range at
    `hoursPerDay` (default 8). Line of business lives on the **parent project**, not the
    role ([ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
    It's a **data-carrying row**,
    not a pure junction. Placeholders let a Project define needed roles before anyone is
    chosen (e.g. during an opportunity's Allocating stage). Today these are **simple
    mutable rows, NOT effective-dated history** like `staff_employment` — so they can't
    reconstruct a past plan, and there's no flow yet to staff a placeholder after the fact.
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

- **Staffing** — given a Project's needs, find People with the right StaffProfile skills and spare capacity, then allocate them for a date range.
- **Capacity planning** — sum each Person's allocations across Projects vs. their availability to spot over/under-allocation.
- **Forecast vs. actuals** — Allocations are the *plan*; TimeEntries are the *actuals*. Comparison drives re-forecasting.

## Connects to

- **Staff profiles** — skills + availability drive who can be allocated.
- **Timesheets** — actuals (`time_entries`) are logged against the same Person↔Project pairing (now **built**; logging isn't restricted to allocated projects). Reconciling actuals against the `project_roles` plan is still unbuilt. See [domains/timesheets.md](./timesheets.md).
- **Performance** — utilization (from allocations vs. availability) is a performance input.

## Open questions

- Capacity unit: percentage, hours/week, or both?
- ~~Soft (tentative) vs. hard (confirmed) allocations?~~ **Resolved** — a role's `status`
  (`tentative` → `confirmed`, auto-confirmed on the opportunity's win) models exactly this.
  See [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md).
- How are conflicts/over-allocation surfaced and resolved? (The `/allocations` planner view
  lists each project a person is on per week with its own %, and the **opportunity planner** now
  greys a staffed person's **other-project commitments** into the grid — a first visibility cut —
  but nothing yet **sums** those into a total weekly load or flags >100% over-allocation.)
- How are the planner-view percentages (the *plan*) reconciled against timesheet
  actuals? Still unbuilt.
