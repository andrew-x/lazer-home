# 0024 — Opportunity → Project handoff: delivery-stage project requirement + placeholder roles

**Status:** accepted · 2026-07-10 · **amended 2026-07-18** (link inverted; same-company invariant now enforced; roles gained provenance + status)

## Amendment (2026-07-18): the link inverted, and the handoff got richer

Three things this ADR left as written have since changed — see
[ADR 0019](./0019-project-opportunity-link.md) and
[ADR 0031](./0031-opportunity-project-planner-and-role-status.md):

- **The link inverted.** The handoff no longer sets `projects.opportunityId` (removed). It
  sets **`opportunities.projectId`** — and the relationship is now **many opportunities → one
  project** (a project can be built up from several deals). `createProject` writes the new
  opportunity's `projectId` inside its transaction (`.returning()`-guarded so a vanished
  opportunity rolls the whole create back); a **second** entry point, `associateOpportunityProject`,
  links an opportunity to an **existing** project. `getOpportunitiesBoard`'s `hasProject` and
  the drawer's linked-project read are now plain column reads off the opportunity.
- **The same-company invariant is now enforced server-side.** `associateOpportunityProject`
  rejects a cross-company project, and `searchProjects` is company-scoped — so the "still not
  enforced" caveat below is **resolved**.
- **Roles gained provenance + status.** `createProject` now tags each created role with its
  originating `opportunityId` and (via schema default) status `tentative`; the auto-confirm-on-won
  flip and the planner UI are [ADR 0031](./0031-opportunity-project-planner-and-role-status.md).

Everything below describing `projects.opportunityId` is the **superseded** prior shape.

## Context

Two prior ADRs left seams open. [ADR 0019](./0019-project-opportunity-link.md) added
the `projects.opportunityId` column but explicitly built no flow to populate it — projects
were still created standalone. [ADR 0017](./0017-project-roles-as-first-allocation-cut.md)
modelled `project_roles` as a *staffed* line (`staffId` NOT NULL): a role only existed
once you knew the person.

But the pipeline itself demands staffing *before* a person is chosen. The **Allocating**
group (`allocating_awaiting_profiles` / `allocating_introing_profiles`) is where we scope
who's needed and start introducing candidates — you're planning open positions, not
recording who's already on. And a deal shouldn't reach that stage with nothing to staff
against. So the handoff, the shape of a not-yet-staffed role, and *when* it's forced are
one coherent problem.

## Decision

**1. Populate the CRM → delivery link.** `createProject` (+ schema + the parameterized
`AddProjectDialog`) now accept an optional `opportunityId` and set the previously-unused
`projects.opportunityId` FK ([ADR 0019](./0019-project-opportunity-link.md)). The dialog is
reused for three entry points — the `/projects` page, the opportunity detail drawer, and
the board's enforcement prompt — via props (`opportunityId`, `defaultCompanyId`/`Name`,
`lockCompany`, controlled `open`/`onOpenChange`, `onCreated`). The same-company invariant
is **still not enforced** (deferred as in ADR 0019).

**2. Placeholder roles + a role-type dimension** (schema change, migration
`drizzle/0023_eager_demogoblin.sql`). On `project_roles`:
- **`staffId` is now NULLABLE.** A null staff means a *placeholder / open position* — a
  role defined before it's staffed. Created by leaving the staff picker blank.
- **`roleType`** (NOT NULL, new `projectRoleTypeEnum`) — the role's *discipline*
  (`ENGINEER`, `DESIGNER`, `ARCHITECT`, `QA`, `SPECIALIST`). This is what identifies an
  open position when there's no person yet. It is **orthogonal to `lineOfBusiness`**:
  role type = what kind of work; line of business = which practice bills it.
- **`name`** (optional text) — a free label, e.g. "Senior Backend Engineer".
- Line of business, dates, and hours remain **required on every role**, staffed or not.
  *(Later changed by [ADR 0025](./0025-line-of-business-on-opportunity-and-project-not-role.md):
  line of business was dropped from the role and moved to the project; dates and hours
  are still required per role.)*
- Role types live in the pure, client-importable `src/lib/projects/project-role-type.ts`
  (`PROJECT_ROLE_TYPES` + labels), the single source the pgEnum, zod, and form share —
  the same pattern as `line-of-business.ts` ([ADR 0016](./0016-junction-table-and-shared-enum-conventions.md)).

**3. Delivery stages require a linked project.** New `requiresProject(status)` in
`src/lib/crm/opportunity-pipeline.ts`: true from the **Allocating** group onward (Allocating →
Negotiating → Closing → Won), with **Closed – Lost excepted**. The invariant — *an
opportunity in a delivery stage has a linked project* — is enforced **server-side at the
entry points**, so it can't be bypassed by hitting an action directly:

- **Creation is forbidden in a delivery stage.** `createOpportunity` rejects any
  `requiresProject(status)` input outright — a brand-new opportunity can't have a linked
  project yet, so that state is unreachable. The error nudges the user to create it earlier
  and add a project as it advances.
- **The guard is transition-based, not state-based.** In `updateOpportunityPosition` and
  `updateOpportunity`, the check fires **only when the status is actually changing into a
  requiring stage without a project** — `newStatus !== currentStatus && requiresProject(newStatus) && !opportunityHasProject(id)`.
  Both actions first fetch the current status to compare. Editing an opportunity already in
  a delivery stage (renaming, changing owners/next-steps) or reordering a card *within* a
  delivery column no longer trips the guard — the earlier every-edit check over-fired and
  blocked unrelated writes. When it does fire it throws a `UserSafeActionError`.

Client-side, dragging a card into Allocating+ with no project is *blocked* (the move isn't
applied) **only on a genuine stage change** (`newStatus !== originStatus`), so an intra-column
reorder never prompts. For a user who can create projects the block auto-opens the
create-project dialog prefilled for that opportunity; on creation the pending move completes.
The board's re-sync signature includes `hasProject`, so linking a project via the detail
drawer flips the card's state and the board stops re-prompting to create a duplicate.

## Consequences

- **RBAC nuance, no RBAC change.** Creating a project needs `projects.edit`; `sales` has
  only `crm.edit`. So a salesperson who drags a deal into a delivery stage without a
  project gets a **toast telling them a delivery manager must create the project** — the
  board gates the prompt on a `canCreateProject` flag (`projects.edit`) passed from the
  page. No permission was widened; the wall is intentional.
- A project created from the Allocating stage will typically carry **placeholder roles**
  (staff unknown), which later get a `staffId` once edit exists. Reads must treat
  `project_roles.staffId` as nullable now.
- `getOpportunitiesBoard` returns a `hasProject` flag (a grouped existence query, no N+1)
  and `companyId` so the board can enforce and prefill without extra round-trips.
- `roleType` is backfilled to `ENGINEER` for existing rows (a temporary default the
  migration then drops), so pre-existing roles are all "Engineer" until edited.

## Alternatives considered

- **A dedicated `open_position` table separate from `project_roles`.** Rejected: a
  placeholder *is* a role with no person yet — same columns, same lifecycle (it becomes
  staffed in place). A nullable `staffId` keeps one table and one read path.
- **Requiring a project from `closed_won` only.** Rejected: staffing (Allocating) and
  contracting (Closing) happen *before* the win, and that's exactly when you need a
  project to plan roles against. Gating at Won would let deals sit in delivery stages with
  nothing behind them.
- **Widening `sales` to `projects.edit`** so salespeople can self-serve the prompt.
  Rejected: project creation is a delivery-manager responsibility; the division of labour
  is deliberate. A toast pointing to the right role is the correct nudge.
- **Client-only enforcement.** Rejected: the requirement is a real invariant, so both
  status-mutating actions check it server-side; the client block is just UX.
