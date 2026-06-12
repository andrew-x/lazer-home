# Domain: Allocations

**Status: proposed.** Staffing People onto Projects over time — the heart of capacity planning.

## Purpose

Decide who works on what, when, and how much — and keep the plan reconcilable against availability and actuals.

## Key entities

- **Allocation** — a *time-ranged* assignment of a Person to a Project: start/end dates, capacity (% or hours/week), and project role.

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
