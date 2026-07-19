# Opportunity-driven projects & role-derived line of business — design

**Date:** 2026-07-19
**Status:** design (approved for spec review)

## Problem / goal

Creating a project from a CRM opportunity currently opens a form that re-collects
data the opportunity already has. We want the opportunity to be the source of truth:

1. **Create-from-opportunity is a one-click, no-form action** — the project inherits
   `name` and `company` from the opportunity.
2. **The project no longer stores `lineOfBusiness` or `status`.** Both become *derived*.
3. **Line of business moves onto the role.** A project's set of lines of business is
   derived from the distinct LoBs of its roles.
4. **Removing a project from an opportunity is context-aware:** if every role on the
   project belongs to that opportunity (and no other opportunity is linked), delete the
   whole project; otherwise delete only that opportunity's roles and unlink the project.

This runs on two triggers: an explicit **"Remove project"** action in the opportunity
planner, and a new **delete-opportunity** flow (which doesn't exist yet).

## Current state (baseline)

- `projects` (`src/lib/db/projects-schema.ts:39-62`): `status` (`projectStatusEnum`,
  notNull, default `tentative`) and `lineOfBusiness` (`lineOfBusinessEnum`, notNull, no
  default). No `opportunityId` — the link is inverted: `opportunities.projectId`
  (`src/lib/db/opportunities-schema.ts:61`, `onDelete: restrict`). Many opportunities can
  point at one shared project.
- `projectRoles` (`projects-schema.ts:104-142`): `status`
  (`projectRoleStatusEnum` = `tentative | confirmed`, default `tentative`),
  `opportunityId` (nullable, `onDelete: set null`) as provenance. **No `lineOfBusiness`.**
- Create flow: `AddProjectDialog` (`src/components/projects/add-project-dialog.tsx`)
  collects name + company + LoB; `createProject`
  (`src/actions/projects/createProject.ts`) inserts the project and (when from an opp)
  sets `opportunities.projectId` under an `isNull` guard.
- **No `deleteProject` action and no `deleteOpportunity` action exist.**
- `assertRoleEditable` (`src/actions/projects/assertRoleEditable.ts`): a role is editable
  only if `status === "tentative"` **and** `role.opportunityId === opportunityId`.
- No `AlertDialog`/confirm primitive exists in the codebase.

## Design

### 1. Data model

**`projects` table** (`src/lib/db/projects-schema.ts`)
- Drop `status`.
- Drop `lineOfBusiness`.
- Result: `id`, `name`, `companyId`, `createdAt`, `updatedAt` (+ relations).

**`projectRoles` table** (`src/lib/db/projects-schema.ts`)
- Add `lineOfBusiness` (`lineOfBusinessEnum`, **notNull**).
- Extend `projectRoleStatusEnum` from `tentative | confirmed` to
  `tentative | confirmed | paused | cancelled`.

**`project-role-status.ts`** (`src/lib/project-role-status.ts`)
- `PROJECT_ROLE_STATUSES = ["tentative", "confirmed", "paused", "cancelled"]`.
- Add labels for `paused` / `cancelled`.
- Add a variant map so the status can render as a badge (see derived badge below).
- `DEFAULT_PROJECT_ROLE_STATUS` stays `tentative`.

**Retire `project-status.ts`** (`src/lib/project-status.ts`)
- Project status is now derived; delete the module and migrate all consumers (see §5).
- `ProjectStatusBadge` is re-pointed at the (now four-state) role-status label + variant
  set, or replaced by a small derived-status badge that consumes role-status labels.

> **Note — paused/cancelled have no user-facing set path in this change.** Per decision,
> we only add the enum values, labels, and derivation. `createProjectRole` still forces
> `tentative`; `updateProjectRole` still doesn't touch status; `assertRoleEditable` is
> **unchanged** (only `tentative` roles are user-editable). The new states are reachable
> via the seed and future work, and are handled by the derivation + badges everywhere.

### 2. Migration

Order matters (add + backfill before drop):

1. `ALTER TYPE project_role_status ADD VALUE 'paused'` / `'cancelled'`
   (Postgres enum additions run outside a transaction — let drizzle-kit generate; verify
   the generated SQL doesn't wrap them in a `BEGIN`).
2. Add `project_roles.line_of_business` as **nullable**.
3. Backfill: `UPDATE project_roles SET line_of_business = projects.line_of_business
   FROM projects WHERE project_roles.project_id = projects.id`.
4. Set `project_roles.line_of_business` `NOT NULL`.
5. Drop `projects.status` and `projects.line_of_business`.

Run `bun run db:generate` then `bun run db:migrate`. The generated migration may need a
hand edit to interleave the backfill (step 3) between add-nullable and set-not-null.

### 3. Derivation rules

**Derived project status** (from the project's roles):
- No roles → `tentative`.
- All roles `cancelled` → `cancelled`.
- Otherwise, over the **non-cancelled** roles: any `tentative` → `tentative`; else any
  `paused` → `paused`; else → `confirmed`.

Implement as a pure helper (e.g. `deriveProjectStatus(roleStatuses)` in
`src/lib/project-role-status.ts` or a new `src/lib/project-derived.ts`) so reads and tests
share one implementation.

**Derived project line(s) of business:** the distinct set of role `lineOfBusiness` values,
in canonical `LINE_OF_BUSINESS` order. Empty project → empty set. Helper
`deriveProjectLinesOfBusiness(roleLobs)` alongside the status helper.

### 4. Actions

**New — `createProjectFromOpportunity`** (`src/actions/projects/`)
- Schema: `{ opportunityId }`.
- Gate: `{ projects: ["edit"] }` (matches `createProject`).
- Logic (transaction): load the opportunity (`name`, `companyId`); guard
  `opportunityHasProject`; insert `projects` with inherited `name` + `companyId` (no LoB,
  no status); atomically set `opportunities.projectId = newId` under the existing
  `isNull(projectId)` guard; create **no roles**. `revalidatePath("/projects")` +
  `/opportunities`.
- Shares the insert+link core with `createProject` via a small internal helper.

**Changed — `createProject`** (standalone path)
- Schema/action: drop `lineOfBusiness` and `status`. Standalone create is name + company
  (+ optional delivery managers / roles). Any roles passed now carry `lineOfBusiness`.

**Changed — `updateProject`**
- Schema/action: drop `lineOfBusiness` and `status`. Keeps `name` + `deliveryManagerIds`.

**Changed — role schemas/actions**
- `projectRole.schema.ts` `projectRoleFields`: add `lineOfBusiness`
  (`LINE_OF_BUSINESS` enum, required).
- `createProjectRole` / `updateProjectRole`: persist `lineOfBusiness`. `createProjectRole`
  still forces `status: "tentative"` and server-tags `opportunityId`.

**New — cleanup helper `detachProjectFromOpportunity(tx, { opportunityId, projectId })`**
(`src/actions/projects/` or `src/actions/crm/`, shared)
Inside a transaction:
1. Load all roles for `projectId`; partition into *this-opp roles*
   (`opportunityId === opportunityId`) vs *other roles* (different opp **or** `null`).
2. Count other opportunities linked to the same project
   (`opportunities.projectId === projectId AND id !== opportunityId`).
3. **Sole owner** (`otherRoles.length === 0 && otherLinkedOpps === 0`):
   set this opp's `projectId = null`, then delete the project (cascades roles + delivery
   managers). This bypasses `assertRoleEditable` deliberately — it's a bulk cleanup, not a
   user field edit.
4. **Otherwise:** delete only *this-opp roles*, set this opp's `projectId = null`.

**New — planner "Remove project"** (`src/actions/projects/`)
- Schema `{ opportunityId }`; gate `{ projects: ["edit"] }`; loads the opp's `projectId`,
  calls the cleanup helper, revalidates. Returns whether the project was deleted or just
  detached (so the UI can message correctly).

**New — `deleteOpportunity`** (`src/actions/crm/`)
- Schema `{ id }`; gate `{ crm: ["edit"] }` (matches other opportunity mutations).
- Transaction: if the opp has a `projectId`, call the cleanup helper first, then delete
  the opportunity row (its junction rows cascade). `revalidatePath("/opportunities")`
  (+ `/projects`).

**Unaffected:** `confirmRolesOnWon` (flips `tentative → confirmed`; the derived project
status then reads `confirmed` automatically) and `associateOpportunityProject`.

### 5. Reads & UI

- **`getProjectsPage`** (`src/actions/projects/getProjectsPage.ts`): stop selecting
  `projects.status`; aggregate each project's role statuses + LoBs, and return
  `derivedStatus` + `linesOfBusiness: LineOfBusiness[]` per row (via the derivation
  helpers).
- **`projects-table.tsx`**: Status column → derived-status badge; **add** a "Line of
  business" column rendering the derived LoB set as chips.
- **`getOpportunityPlan` / `PlanProject`** (`getOpportunityPlan.ts`): drop stored
  `status`/`lineOfBusiness`; compute derived status + LoB set from the roles already
  loaded.
- **`opportunity-project-plan.tsx`**: project stat card shows derived status + LoB chips
  (replacing the single LoB hint at line 329 and the `PROJECT_STATUS_LABELS` use at line
  79); the edit-project dialog drops the Status and LoB selects (keeps name + delivery
  managers). Add a **"Remove project"** control on the project card with an
  `AlertDialog` confirm whose copy reflects delete-vs-detach.
- **`RoleDialog`** (`opportunity-project-plan.tsx:766-998`): add a **Line of business**
  `EnumSelect` to the field grid. Default value = the opportunity's LoB (passed as a prop;
  `PlanEditor` already receives `lineOfBusiness`) when creating; editable. `RoleFormValues`
  gains `lineOfBusiness`.
- **From-opportunity entry points become one click** (no dialog): the planner
  `NoProjectState` button and the board delivery-stage prompt
  (`opportunity-board.tsx`) call `createProjectFromOpportunity`. The standalone
  `AddProjectDialog` on the projects page keeps its dialog, minus the LoB field.
- **`opportunity-detail-sheet.tsx`**: add a **"Delete opportunity"** control (header row
  near line 328) wired to `deleteOpportunity` behind an `AlertDialog` confirm; close the
  sheet + refresh on success.
- **`getStaffProjects.ts`**: migrate its `ProjectStatus` use to the derived status.
- **Add the `AlertDialog` primitive** (`bunx --bun shadcn@latest add alert-dialog`) — none
  exists yet — and use it for both destructive confirms.

### 6. Seed

`scripts/seed/projects.ts`:
- Stop setting project `status` / `lineOfBusiness`.
- Set each role's `lineOfBusiness` (inherit the originating opportunity's LoB; random from
  `LINE_OF_BUSINESS` for standalone roles).
- Optionally set some roles to `paused` / `cancelled` so the new states + derivation are
  exercised.
- Update imports (drop `PROJECT_STATUSES`; the project LoB import).

### 7. Permissions

No new permission keys. `deleteOpportunity` gates on `crm.edit`; the planner remove-project
action and role changes gate on `projects.edit` — consistent with the existing matrix
(`src/lib/permissions.ts`). The RBAC matrix, its test, and the docs stay in lockstep (no
change needed since we reuse existing gates).

### 8. Docs

After implementation, dispatch the **librarian** to reconcile `/docs` — `data-model.md`,
`domains/projects.md`, `domains/crm.md`, and the relevant ADRs (the opportunity↔project
link, and the LoB-on-project decision from ADR referenced in
`2026-07-13-line-of-business-opportunities-projects-design.md`, now superseded by
LoB-on-role).

## Out of scope

- No user-facing path to set roles to `paused`/`cancelled` (enum + derivation only).
- No changes to `assertRoleEditable` (only `tentative` roles remain user-editable).
- No `.delete` permission split — reuse `.edit` gates.
- No "pause/cancel the whole project" bulk action.

## Testing

- Unit-test the derivation helpers (`deriveProjectStatus`, `deriveProjectLinesOfBusiness`)
  across: no roles, all-cancelled, mixed tentative/paused/confirmed, single LoB, multi LoB.
- `detachProjectFromOpportunity`: sole-owner delete; shared-project (other opp linked)
  detach; project with unassigned roles → detach; project with another opp's roles →
  detach.
- `createProjectFromOpportunity`: inherits name/company; one-project-per-opp guard.
- `bun run check` (Biome + tsc + tests, incl. the RBAC matrix) and `bun run build`; keep
  the seed green.
