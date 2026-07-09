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
    staffing line = a `staff` member on a `lineOfBusiness` for a `startDate`/`endDate`
    range at `hoursPerDay` (default 8). It's a **data-carrying row**, not a pure
    junction. Today these are **simple mutable rows, NOT effective-dated history** like
    `staff_employment` — so they can't reconstruct a past plan. When this domain grows
    beyond create+read, `project_roles` may need to evolve toward history-as-rows. See
    [projects.md](./projects.md) and [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md).

## Key flows

- **Staffing** — given a Project's needs, find People with the right StaffProfile skills and spare capacity, then allocate them for a date range.
- **Capacity planning** — sum each Person's allocations across Projects vs. their availability to spot over/under-allocation.
- **Forecast vs. actuals** — Allocations are the *plan*; TimeEntries are the *actuals*. Comparison drives re-forecasting.

## Connects to

- **Staff profiles** — skills + availability drive who can be allocated.
- **Timesheets** — actuals are logged against the same Person↔Project pairing.
- **Performance** — utilization (from allocations vs. availability) is a performance input.

## Open questions

- Capacity unit: percentage, hours/week, or both?
- Soft (tentative) vs. hard (confirmed) allocations?
- How are conflicts/over-allocation surfaced and resolved?
