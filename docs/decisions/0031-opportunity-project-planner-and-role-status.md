# 0031 — Opportunity project planner: role `status` (tentative → confirmed), auto-confirm on won, weekly Gantt view

**Status:** accepted; amended by [ADR 0033](./0033-line-of-business-on-role-derived-project-status.md) · 2026-07-18

> **Amended, 2026-07-19 ([ADR 0033](./0033-line-of-business-on-role-derived-project-status.md)).**
> The role `status` enum **expanded** from `tentative | confirmed` to
> `tentative | confirmed | paused | cancelled` (the two new states are enum-only for
> now — no UI sets them yet). The separate **stored project `status`** this ADR relied
> on is **gone**: a project's status is now *derived* from its roles' statuses
> (`deriveProjectStatus` in `src/lib/project-derived.ts`; `src/lib/project-status.ts`
> deleted). The role lifecycle, `assertRoleEditable`, auto-confirm-on-won, and the
> planner grid below all still hold.

## Context

The opportunity drawer's "Project plan" tab used to be a thin shell — a "Create project"
button and a read-only linked-project display ([ADR 0024](./0024-opportunity-project-handoff-and-placeholder-roles.md)).
Sales/delivery needed to actually *plan staffing* against a deal while it's still in the
pipeline: sketch who's needed and when, before the deal is won, and revise it as the deal
matures — without those tentative plans being mistaken for committed allocations.

Two prior open questions bore directly on this (both now resolved here):

- **"Soft (tentative) vs hard (confirmed) allocations?"** ([allocations.md](../domains/allocations.md)) —
  the planner forced the answer.
- **The many-opps → one-project inversion** ([ADR 0019](./0019-project-opportunity-link.md)) —
  a project is a shared delivery vehicle several deals (an original + extensions / change
  requests) feed roles into, so the planner has to show *all* of a project's roles while
  letting you edit only the ones this opportunity owns.

## Decision

**1. A role planning `status`: `tentative` → `confirmed`.** `project_roles` gains a
`status` column (`projectRoleStatusEnum`, NOT NULL, DB default `tentative`) and an
`opportunityId` provenance FK (nullable, `onDelete: set null`, indexed) recording *which
opportunity created the role*. Both are **server-controlled provenance, never user input**
(the shared `projectRole.schema.ts` excludes them). Status values live in the pure,
client-importable `src/lib/project-role-status.ts` (`PROJECT_ROLE_STATUSES`,
`DEFAULT_PROJECT_ROLE_STATUS`, `PROJECT_ROLE_STATUS_LABELS`) — the same single-source pattern
as `project-status.ts` / `project-role-type.ts`. Migration `drizzle/0002_loud_sister_grimm.sql`.

- **Tentative** = a role being planned against an opportunity; editable in that opportunity's
  planner.
- **Confirmed** = locked in, read-only. A role flips to confirmed when its opportunity is won.

**2. Auto-confirm on Closed-Won.** `src/actions/crm/confirmRolesOnWon.ts` flips every
`tentative` role tagged with an opportunity to `confirmed` — but **only on a genuine
transition into `closed_won`** (`nextStatus === "closed_won" && prevStatus !== "closed_won"`),
so re-saving an already-won deal is a no-op. It's wired into all three status-mutating paths
(`updateOpportunityField`'s status case, `updateOpportunity`, `updateOpportunityPosition`),
each of which now **captures the prior status and runs the status write + the role flip in one
transaction** so they commit atomically.

**3. The edit guard: `assertRoleEditable`.** You may only edit/delete a role that is
**tentative** *and* **tagged with the current opportunity**. This lives in one shared guard
(`src/actions/projects/assertRoleEditable.ts`), mirroring `assertOpportunityTransitionAllowed`
— a data-integrity invariant *on top of* the `projects.edit` RBAC gate, not a substitute for
it. Confirmed roles and roles from *other* opportunities are read-only in this drawer.

**4. The planner: a weekly, Gantt-like grid.** `src/components/crm/opportunity-project-plan.tsx`
renders roles × week columns, rows grouped by person (so an extension stacks as another block
on the same person's line). The grid math is a pure, unit-tested module
`src/lib/project-planner-grid.ts` (`buildWeekColumns`, `buildPlannerRows`, `weekColumnLabel`,
`weekSpan`) — mirroring `timesheet-grid.ts`, with a new `eachWeek(start, end)` helper in
`timesheet-week.ts`. The component is render + action-wiring only. Editable blocks are this
opportunity's tentative roles; everything else renders greyed. Empty state offers **associate
an existing project** or **create a new one**.

**5. Two ways to link, both gated `projects.edit`.** `createProject` (new project) and
`associateOpportunityProject` (existing project) — and the role CRUD (`createProjectRole`,
`updateProjectRole`, `deleteProjectRole`, `extendProjectRole`) plus the `searchProjects`
picker. All gated **`projects.edit`**, not `crm.edit`: choosing/planning delivery is a
delivery-manager decision even though associating writes an `opportunities` column. The
interactive planner *read* (`loadOpportunityPlan`) is gated `crm.edit` because it lives in the
edit-only drawer; the underlying `getOpportunityPlan` is a server-only read. No matrix change
(`/audit-rbac` clean).

## Consequences

- **The "soft vs hard allocation" question is answered:** tentative = soft/planned,
  confirmed = hard/committed, with winning the deal as the promotion event. This is still a
  *status flag on simple rows*, not effective-dated allocation history — the
  [ADR 0017](./0017-project-roles-as-first-allocation-cut.md) scope call stands.
- **Extending a role adds a new row.** `extendProjectRole` inserts a fresh tentative segment
  sharing the source role's `staffId`/`name`/`roleType`; the planner groups shared-staff rows
  into one person line. The source may be confirmed or from another opportunity (you're
  extending *someone's* allocation), but must live on this opportunity's project.
- **A confirmed role can't be edited from the planner.** The planner scopes role edits to this
  opportunity's own *tentative* roles, so once a deal is won its roles are effectively frozen —
  there is no project-side role-edit flow. (Project-level fields *are* now editable post-create
  via `updateProject`, but that never touches roles — see [projects.md](../domains/projects.md)
  open questions.)
- **`project_roles.opportunityId` is `set null`.** Deleting the originating opportunity keeps
  the role (its `projectId` still holds it) but loses the provenance — the role then reads as
  greyed/un-owned in any planner.

## Alternatives considered

- **A separate `allocations` table with a plan/actual distinction, instead of a status flag.**
  Rejected for now: `project_roles` already *is* the first allocation cut; a status column is
  the minimal way to model soft-vs-hard without a second table and a migration of the read
  paths. Revisit when the full Allocations domain lands.
- **Confirm roles at Closing (contract) rather than Won.** Rejected: until the deal is
  actually won the plan can still change; `closed_won` is the unambiguous commit point.
  (Contrast the *project requirement*, which fires earlier at Allocating — you plan before you
  commit.)
- **Let the planner edit any role on the shared project.** Rejected: a project fed by several
  opportunities would let one deal's drawer silently rewrite another's roles. Scoping edits to
  this opportunity's own tentative roles (`assertRoleEditable`) keeps each deal's plan its own.
- **Enforce editability only in the UI.** Rejected: same reasoning as the delivery-stage guard
  — a real invariant is enforced server-side in every mutating action, the greying is just UX.
