# 0033 — Line of business moves to the role; project status & LoB are derived; one-click create + delete/detach

**Status:** accepted · 2026-07-19

## Context

[ADR 0025](./0025-line-of-business-on-opportunity-and-project-not-role.md) put line
of business (and, with [ADR 0031](./0031-opportunity-project-planner-and-role-status.md),
a lifecycle `status`) as **stored, project-level** columns on `projects`. Once the
opportunity planner made a project a **shared delivery vehicle** several deals feed
roles into ([ADR 0019](./0019-project-opportunity-link.md),
[ADR 0031](./0031-opportunity-project-planner-and-role-status.md)), both of those
project-level scalars became wrong in the same way ADR 0025 had earlier argued the
role-level LoB was wrong — only in the opposite direction:

- **One project can legitimately span practices.** An original CORE deal plus a later
  FINTECH change request both feed roles into one project. A single project-level
  `lineOfBusiness` can't represent that; forcing one practice onto the shared vehicle
  loses the per-deal signal.
- **A stored project `status` drifts from its roles.** Roles already carry the real
  planning lifecycle (`tentative → confirmed`, plus `paused`/`cancelled`). A separate
  project-level status was a second source of truth that had to be hand-maintained and
  could disagree with the roles beneath it.
- **Creating a project from an opportunity still asked for a form** (name + company +
  LoB) even though every field could be inherited from the opportunity.

## Decision

**1. Line of business moves back down to the role.** `project_roles` gains
`lineOfBusiness` (`lineOfBusinessEnum().notNull()`); `projects.lineOfBusiness` is
dropped. A role created from an opportunity **inherits that opportunity's LoB by
default** (the planner UI prefills it; still editable). A project's set of lines of
business is **derived** as the distinct LoBs across its roles.

This is a **partial reversal of [ADR 0025](./0025-line-of-business-on-opportunity-and-project-not-role.md)**:
LoB is once again a role column. But ADR 0025's other calls stand — LoB stays on
**opportunities** (the pipeline still segments deals by practice), and its schema
split (opportunities in their own file) is untouched.

**2. Project status & LoB are derived, never stored.** `projects` drops both `status`
and `lineOfBusiness`; it is now just `id`, `name`, `companyId`, timestamps (plus the
delivery-managers / roles relations). The `project_status` enum and
`src/lib/project-status.ts` are **deleted**. A new pure, client-importable module
`src/lib/project-derived.ts` computes both (unit-tested in `project-derived.test.ts`),
shared by every read (`getProjectsPage`, `getOpportunityPlan`, `getStaffProjects`),
the UI, and tests:

- `deriveProjectStatus(roleStatuses)` — no roles ⇒ `tentative`; all roles `cancelled`
  ⇒ `cancelled`; else over the **non-cancelled** roles, **least-committed wins**: any
  `tentative` ⇒ `tentative`, else any `paused` ⇒ `paused`, else `confirmed`. This
  means a project reads `confirmed` only once **all** its live roles are confirmed —
  exactly what `confirmRolesOnWon` produces when an opportunity is won.
- `deriveProjectLinesOfBusiness(roleLobs)` — the distinct LoBs in canonical
  `LINE_OF_BUSINESS` order.

**3. The role status enum expands to four states.** `projectRoleStatusEnum` grows from
`tentative | confirmed` to `tentative | confirmed | paused | cancelled`
(`src/lib/project-role-status.ts`, with shared labels + badge variants). The two new
states are **enum-only for now** — no user-facing control sets them yet (the seed
exercises them; the derivation and badges already handle them). `ProjectStatusBadge`
renders the *derived* project status using these four-state role labels/variants.

**4. Creating a project from an opportunity is one-click, no form.** New action
`createProjectFromOpportunity` (gated `projects.edit`) inherits the opportunity's
`name` + `companyId`, sets `opportunities.projectId` under the existing one-project-
per-opportunity `isNull` guard, and creates **no roles**. The planner's empty-state
"Create project" button and the board's delivery-stage prompt (now a **confirm
dialog**, not the old form) both call it directly. The standalone `AddProjectDialog`
on `/projects` now collects only **name + company** (`createProject`/`updateProject`
dropped their LoB/status inputs; `createProject` still exists for standalone projects
and its roles now each carry a `lineOfBusiness`).

**5. A real delete/detach flow.** Shared helper `detachProjectFromOpportunity`: when
an opportunity's project is **sole-owned** (all roles are this opportunity's AND no
other opportunity links to it AND no unassigned roles) the **whole project is
deleted** (cascading roles + delivery managers, after nulling this opportunity's
`projectId` to release the FK `restrict`); otherwise **only this opportunity's roles**
are deleted and the project is unlinked. Two callers: `removeProjectFromOpportunity`
(planner "Remove project", gated `projects.edit`) and the new `deleteOpportunity`
(gated `crm.edit` — the app's first delete-opportunity flow), which runs the detach
**before** deleting the opportunity row so role provenance survives.

**Migration `drizzle/0001_gray_corsair.sql`** (applied): adds the two new enum values,
adds `project_roles.line_of_business` (backfilled from the parent project, then set
NOT NULL), drops `projects.status` + `projects.line_of_business`, drops the
`project_status` type. No permission-matrix change (`projects.edit` + `crm.edit`
reused).

## Consequences

- **[ADR 0025](./0025-line-of-business-on-opportunity-and-project-not-role.md) is
  superseded on its central point** (LoB on the project). LoB now lives on staff
  employment, **opportunities**, and **`project_roles`** — no longer on `projects`.
- **[ADR 0031](./0031-opportunity-project-planner-and-role-status.md)'s stored project
  status is superseded** by derivation; its role `status` lifecycle, `assertRoleEditable`
  guard, auto-confirm-on-won, and the planner grid all stand, now over four states.
- **A project can span practices** — the shared-vehicle case ADR 0025 declined is now
  supported, cheaply, because LoB rides on the role.
- **No hand-maintained project status.** There is no `updateProject`-style status
  editor and no drift risk: status always reflects the roles. `updateProject` now
  edits only name + delivery managers.
- **One source of truth for the two lifecycle scalars** — `project-derived.ts` is
  imported by reads, UI, and tests alike (client-safe, no `db`).

## Alternatives considered

- **Keep a stored project status, sync it on every role write.** Rejected: a second
  source of truth that can drift; derivation is free and always correct.
- **Keep LoB on the project, add a project↔LoB set.** Rejected: over-modelled — the
  roles already carry the LoB signal per staffing line, so the project's set falls out
  for free via derivation.
- **A user-facing control for `paused`/`cancelled` now.** Deferred: the enum states
  and their derivation/badges are in place, but no UI sets them yet — added when the
  planner grows role state controls, without another migration.
</content>
</invoke>
