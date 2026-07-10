# 0017 — `project_roles` as the first cut of Allocation (simple rows, not effective-dated)

**Status:** accepted · 2026-07-08

## Context

The Projects feature is the first slice of the long-"proposed" Project entity, and
with it the first concrete cut of the **Allocation** concept (a Person on a Project
for a date range at some capacity — see [allocations.md](../domains/allocations.md)).

Two modelling questions arose:

1. **Where does the staffing line live?** A pure junction (like the CRM
   `opportunity_*` tables and `project_delivery_managers`) can only link a project to
   a staff member — but an allocation carries data: line of business, a date range,
   and hours/day.
2. **Should a staffing line be effective-dated?** `docs/data-model.md` states a
   standing nuance: *everything time-bound (allocations, rates, reviews, employment)
   needs effective-dated handling*, and the realized pattern is history-as-rows
   (`staff_employment`, [ADR 0007](./0007-staff-employment-effective-dating.md)). A
   full Allocation domain would want that (re-plans over time, forecast vs. actuals).

## Decision

**`project_roles` is a data-carrying table, not a pure junction.** Beyond
`projectId`/`staffId` it carries `lineOfBusiness` (the shared `lineOfBusinessEnum`),
`startDate`/`endDate` (`date`, string mode), and `hoursPerDay` (`numeric(4,2)`,
number mode, default 8). It follows the junction FK/index conventions where they
apply (indexes on both FKs) but deliberately has **no `unique` on the FK pair** — the
same person can hold multiple role lines on one project (e.g. different date ranges or
lines of business).

> **Updated by [ADR 0024](./0024-opportunity-project-handoff-and-placeholder-roles.md):**
> `staffId` is now **nullable** — a null role is a *placeholder / open position* defined
> before it's staffed — and the table gained `roleType` (a NOT NULL discipline enum,
> distinct from line of business) and an optional `name`. Line of business, dates, and
> hours stay required on every role.

**FK delete behaviour is asymmetric:** `projectId` → projects **cascade** (a role dies
with its project), `staffId` → staff **`restrict`** (a *staffed* role without its person is
meaningless, and deleting a staff member who has live roles should be blocked, not
silently drop their allocations). This mirrors the `opportunities.companyId` restrict
reasoning from [ADR 0016](./0016-junction-table-and-shared-enum-conventions.md).

**Roles are stored as simple, mutable rows — NOT effective-dated history.** A role's
dates/hours represent the *current* plan; changing them (once edit exists) updates the
row in place. We are **not** versioning allocations as history-as-rows yet.

`lineOfBusiness` reuses the shared, single-source `LINE_OF_BUSINESS` module
(`src/lib/line-of-business.ts`), extracted so the pgEnum, the zod schema, and the form
share one tuple — the same pattern [ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)
established for the opportunity enums.

## Consequences

- The Project entity and the `Company ──< Project` and `Project >──< Person` (via
  `project_roles`) relationships in `docs/data-model.md` are now **partially realized**,
  not merely proposed.
- Capacity planning that needs to reconstruct *what the plan was on a past date*
  (re-forecasting, forecast-vs-actuals history) is **not** supported by simple rows.
  When the full Allocations domain lands, `project_roles` may need to evolve toward the
  effective-dated history-as-rows pattern (or grow an audit trail). Treat today's shape
  as the minimal first cut, consistent with the data-model nuance being *aspirational*
  for allocations, not yet met.
- No `unique` on `(projectId, staffId)` means writers don't need to dedupe role rows
  (unlike the delivery-manager junction, which does dedupe) — overlapping/duplicate
  role lines are allowed and are a validation concern for later, not a DB constraint.

## Alternatives considered

- **A pure junction + a separate allocation table** — rejected as premature; the role
  line *is* the allocation for this slice, so one data-carrying table is simpler.
- **Effective-dated `project_roles` from day one** (history-as-rows like
  `staff_employment`) — rejected for scope: the feature is create + read only, there's
  no re-planning UI yet, and history-as-rows adds real complexity (latest-per-key
  reads, in-place-vs-new-row commit branching). Deferred until the Allocations domain
  needs it; flagged here so it isn't forgotten.
- **`unique(projectId, staffId)`** — rejected: a person legitimately holds multiple
  lines on one project (different periods / lines of business).
</content>
