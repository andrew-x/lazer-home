# Domain: Timesheets

**Status: proposed.** Time capture, approval, and the basis for billing.

## Purpose

Record what People actually worked on so we can bill clients, measure utilization, and compare actuals to the allocation plan.

## Key entities

- **TimeEntry** — hours a Person logged against a Project (optionally a task) on a date; flagged billable or non-billable.
- **Timesheet** — a Person's TimeEntries for a period, submitted for approval.

## Key flows

- **Logging** — a Person records TimeEntries against Projects they're allocated to.
- **Approval** — submit → manager review → approve/reject → locked for billing. Locked entries shouldn't change without an audit trail.
- **Billing basis** — approved billable hours × charge rate; margin = (charge − cost) × hours.

## Connects to

- **Allocations** — actuals (TimeEntries) reconcile against the plan (Allocations).
- **Performance** — billable vs. available hours = utilization.
- **CRM/Project** — entries roll up to the Project (and its CRM Company) for billing.

## Open questions

- Approval granularity (per entry, per timesheet, per project)?
- Can People log time against Projects they aren't allocated to?
- Lock/correction policy after approval.
