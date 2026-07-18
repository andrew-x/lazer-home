# Domain: Allocations

**Status: proposed as a full domain — partially realized.** Staffing People onto
Projects over time — the heart of capacity planning. The first concrete cut of the
Allocation entity **already exists** as `project_roles` in the Projects domain (see
[projects.md](./projects.md)); the full domain below (capacity planning, forecast vs.
actuals, conflict handling) is still proposed.

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
- How are conflicts/over-allocation surfaced and resolved? (The planner shows one project's
  roles per person, but nothing yet sums a person's load *across* projects.)
