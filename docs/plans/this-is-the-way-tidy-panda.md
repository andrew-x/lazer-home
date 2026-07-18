# Opportunity project planner + many-opps→one-project

## Context

Today a project is a company's billable work with staffing "roles" (`project_roles`),
and an opportunity links to **at most one** project (and vice-versa) via
`projects.opportunityId` + a partial unique index (ADR 0019/0024). Roles are simple rows
with no status and no link back to the opportunity that created them, and there is no
edit flow — roles can only be set at project-create time.

We want projects to behave the way the consultancy actually works: a project is a living
**collection of roles that grows over time** as extensions and change requests land, each
of which is its own opportunity. From an opportunity you plan staffing against a project —
either a **new** project or an **existing** one being extended — using a **weekly planner**
(a Gantt-like grid) inside the opportunity drawer. Roles you plan are **tentative** and
editable; roles that are locked in are **confirmed** and greyed; roles from **other**
opportunities on the same project are visible but read-only. The outcome: staffing a deal
becomes a visual, editable plan that accumulates onto one project across many deals.

## Locked decisions (from the user)

1. **Invert the link:** many opportunities → one project. The "which project delivers this
   opportunity" pointer moves from `projects.opportunityId` (1:1) to **`opportunities.projectId`**
   (nullable FK, many-to-one). This reverses ADR 0019/0024's 1:1 rule.
2. **Role status** (`tentative`/`confirmed`) auto-flips to **confirmed when the opportunity
   is marked Closed-Won**. Roles carry the opportunity that created them.
3. **Planner rows grouped by person:** a staffed person = one row (their multiple role
   segments render as separate blocks); each placeholder/open role = its own row.
4. **Full feature in one pass.**

## Schema changes

`src/lib/db/projects-schema.ts` and `src/lib/db/opportunities-schema.ts`:

- **Remove** `projects.opportunityId` and its `projects_opportunity_idx` partial unique
  index (drop the now-unused `uniqueIndex`/`sql` imports).
- **Add** `opportunities.projectId` — `text().references(() => projects.id, { onDelete: "restrict" })`
  + `index("opportunities_project_idx")`. `restrict` preserves ADR 0019's provenance
  protection (a project referenced by an opp can't be deleted; no project-delete flow exists
  anyway). Requires `import { projects }` in `opportunities-schema.ts`.
- **Add** to `project_roles`: `status` (`projectRoleStatusEnum`, NOT NULL, default `tentative`)
  and `opportunityId` (`text().references(() => opportunities.id, { onDelete: "set null" })`,
  = which opportunity created the role) + `index("project_roles_opportunity_idx")`.
- **New shared module** `src/lib/project-role-status.ts` (mirrors `project-status.ts`):
  `PROJECT_ROLE_STATUSES = ["tentative","confirmed"] as const`, `DEFAULT_PROJECT_ROLE_STATUS`,
  labels — the single source the pgEnum, zod, and UI labels all import.
- **Circular import:** the two schema files now reference each other (both via lazy
  `() => Table.id` callbacks, ESM-safe). Verify `tsc --noEmit` and `db:generate` don't choke.

## Migration

`bun run db:generate` emits the enum, the two `project_roles` columns + indexes, the
`opportunities.projectId` column/FK/index, and the drop of the old column/index. **Hand-insert
a backfill** into the generated SQL, ordered **after** the add-column steps and **before** the
drop:

```sql
UPDATE "opportunities" o SET "project_id" = p."id"
FROM "projects" p WHERE p."opportunity_id" = o."id";
```

Optionally also backfill existing roles' `status`/`opportunity_id` for realism (not required
for green). Then `bun run db:migrate` (remote Neon DB — assume it applies cleanly).

**Seed** (`bun run check` must stay green): `scripts/seed/projects.ts` — add the new role
columns, remove `opportunityId` from project inserts, and add an
`UPDATE opportunities SET project_id = …` for each won opp that consumed a project; tag
won-project roles `status:"confirmed", opportunityId: opp.id` and standalone-project roles
`tentative`/`null`. `scripts/seed/sales.ts` — verify only (new nullable col is optional on insert).

## Server layer

**Inverted reads** (change the join from `projects.opportunityId = opportunities.id` to
`opportunities.projectId = projects.id`):
- `src/actions/crm/opportunityHasProject.ts` — rewrite to read `opportunities.projectId is not null`.
- `src/actions/crm/getOpportunity.ts` — change `OpportunityDetail.projects: EntityRef[]` →
  `project: EntityRef | null`; fetch the single project via `opportunities.projectId`.
- `src/actions/crm/getOpportunitiesBoard.ts` — select `opportunities.projectId`, drop the
  separate project query, compute `hasProject = projectId != null`.
- `src/actions/crm/getCompanyDetail.ts` (referred-projects join) and
  `src/actions/crm/getContactDetail.ts` (`referredProjects`) — invert their joins.

**Create/associate:**
- `src/actions/projects/createProject.ts` — stop setting `projects.opportunityId`; when an
  `opportunityId` is passed, set `opportunities.projectId = newProjectId` in the same
  transaction and tag the created roles with `opportunityId` + `status:"tentative"`. Rework
  the pre-check to mean "opp already has a projectId".
- **New** `src/actions/crm/associateOpportunityProject.ts` (+ schema) — set
  `opportunities.projectId` to an existing project. **Gated `projects.edit`** (it's a delivery
  decision, not CRM — flag this: it writes a CRM column but is a delivery action). **Enforce
  the same-company invariant** here (finally closing the ADR 0019 gap): reject if
  `project.companyId !== opportunity.companyId`; reject if already linked.
- **New** `src/actions/projects/searchProjects.ts` — the existing-project picker, `projects.edit`,
  **company-scoped** (only returns same-company projects, so cross-company linking is impossible).

**Role CRUD** (all `projects.edit`; extract a shared `projectRoleSchema` from
`createProject.schema.ts` rather than duplicate field rules) under `src/actions/projects/`:
- `createProjectRole.ts` — insert one tentative role tagged with the current `opportunityId`.
- `updateProjectRole.ts` — edit a role; **body guard: only `status==="tentative"` roles whose
  `opportunityId` matches the caller's current opportunity** (load-then-assert; a data-dependent
  ownership check).
- `deleteProjectRole.ts` — same tentative + own-opportunity guard.
- `extendProjectRole.ts` — "add to an existing role": read a source role's `projectId`/`staffId`/
  `roleType`/`name`, insert a **new** tentative segment (new `project_roles` row sharing the
  `staffId`) tagged with the current opportunity. The planner groups shared-`staffId` rows into
  one person-row.

**Auto-confirm-on-Won** — new `src/actions/crm/confirmRolesOnWon.ts` (`server-only`,
`(tx, opportunityId, nextStatus, prevStatus)`): on a genuine transition into `closed_won`,
`UPDATE project_roles SET status='confirmed' WHERE opportunity_id = ? AND status='tentative'`.
Wire into the three status-setting actions — `updateOpportunityField.ts` (status case),
`updateOpportunity.ts`, `updateOpportunityPosition.ts` — **inside a transaction** with the status
write (the field/position actions are currently non-transactional single updates; wrap the Won path).

**Planner read** — new `src/actions/projects/getOpportunityPlan.ts` (`server-only`) + thin
`loadOpportunityPlan.ts` (`'use server'`, `crm.edit`, delegates — same split as
`loadOpportunityDetail`→`getOpportunity`). For an opportunity's associated project it returns
project meta, **all** roles (LEFT-joined to `staff` for names — placeholders survive), each with
`status`/`opportunityId`/dates/hours, plus computed `timeline {start,end}` and `roleCount`
(min/max over ISO date strings in JS; no N+1, follow `getProjectsPage.ts`'s grouped pattern).
Editability (`tentative && opportunityId === currentOpp`) is derived client-side.

## Planner grid math (pure, testable)

- Add **`eachWeek(startWeek, endWeek): string[]`** to `src/lib/timesheet-week.ts` (the missing
  range helper; generic week math belongs here) — steps ISO-Mondays inclusive via `addWeeks`.
- New **`src/lib/project-planner-grid.ts`** + `.test.ts` (mirrors `timesheet-grid.ts`; no db/React):
  - `buildWeekColumns(roles)` — `eachWeek` over `min(startDate)`→`max(endDate)`; `[]` when empty.
  - `buildPlannerRows(roles, weekColumns, currentOpportunityId)` — bucket by `staffId` (one
    person-row aggregating all their role **segments**); each placeholder (null `staffId`) is its
    own row. Per row compute `active: boolean[]` (a week is active if any segment covers it) and
    per-segment `{ editable, status }`. Order: staffed rows (alpha) then placeholders, mirroring
    `timesheet-grid.buildRows` discipline.
  - Tests: min/max span, single-week roles, a person with a gap between two segments, one-row-per-
    placeholder, editability flag by (status × opportunity).

## UI

`src/components/crm/opportunity-detail-sheet.tsx`:
- **Widen the drawer**: change `data-[side=right]:sm:max-w-3xl` (line 105) to a >half-screen cap
  (e.g. `sm:max-w-[64rem]`). Re-check the left close-tab hang-off at the new width.
- Swap `detail.projects[0]` / `.length` → `detail.project` / `!!detail.project`.
- Replace the thin "Project plan" tab body with a new **`src/components/crm/opportunity-project-plan.tsx`**:
  - **Summary header**: reuse `StatCard` (`src/components/performance/stat-card.tsx`) for timeline
    length + role count.
  - **Planner grid**: the shadcn `Table` pattern from `src/components/timesheets/timesheet-week.tsx`
    — sticky left column (person/role label with type + hours/day allocation), week columns as
    headers, a "block" cell (`bg-muted`/`bg-secondary`, flat + border per the design language — **no
    indigo**) where `active[i]`. Confirmed / other-opportunity segments render **greyed & read-only**;
    editable tentative segments are interactive. Horizontal scroll (`overflow-x-auto`) for long spans.
  - **Write controls** (gated on the drawer's existing `canCreateProject` flag): add-role, edit/extend
    a tentative role (reuse `InlineEditField` / a small role dialog echoing `add-project-dialog.tsx`'s
    role sub-form and `DatePicker`), and — when no project yet — **associate an existing project**
    (`searchProjects` picker) **or** create a new one (existing `AddProjectDialog`). "Extend" adds a
    segment to an existing person's row; "new row" adds a fresh role/placeholder.
- Data via `loadOpportunityPlan` through `useAction` (same load/refresh pattern as
  `loadOpportunityDetail`); refresh after every role/associate write.

## RBAC (must not break)

- Planner **reads are open**; every **write** (role CRUD, associate, create) is gated `projects.edit`
  server-side and hidden behind `canCreateProject` client-side — the same intentional wall as ADR 0024
  (a `sales` user with only `crm.edit` sees the plan read-only).
- `associateOpportunityProject` writes an `opportunities` column but is a **delivery** action → gate
  `projects.edit`, not `crm.edit`.
- The inversion introduces a **new cross-company exposure** the old code structurally avoided (create
  locked the company). Enforce same-company in **both** `searchProjects` (filter) and
  `associateOpportunityProject` (assert). Run **`/audit-rbac`** after.

## Build sequence

1. `src/lib/project-role-status.ts`.
2. Schema edits (both files) — verify circular import compiles.
3. `db:generate` → hand-insert backfill → `db:migrate`.
4. Fix inverted reads + `createProject` + seed. `bun run check`.
5. `confirmRolesOnWon.ts` + wire into 3 status actions (transactions).
6. Role CRUD actions + shared `projectRoleSchema`.
7. `associateOpportunityProject.ts` + company-scoped `searchProjects.ts`.
8. `eachWeek` + `project-planner-grid.ts` + test.
9. `getOpportunityPlan.ts` + `loadOpportunityPlan.ts`.
10. UI: widen sheet, `projects→project`, planner component + role/associate dialogs.

## Verification

- `bun run check` (Biome + `tsc` + `bun test`, incl. new grid/status tests) and `bun run build`.
- `/audit-rbac` — confirm no gate weakened, cross-company link rejected.
- End-to-end (`/run` the app): open an opportunity drawer → Project plan tab is wide; create a
  project with roles → they show as editable tentative blocks; associate a second opportunity with
  the same (same-company) project and add an extension role → it appears on the same person's row;
  drag/mark the first opportunity to **Closed-Won** → its roles grey out as confirmed and are no
  longer editable, while the other opportunity's tentative roles stay editable; verify a cross-company
  project can't be picked; verify the board's delivery-stage "requires a project" enforcement still fires.
- After merge: dispatch the **librarian** subagent to reconcile `/docs` (data-model, domains/projects,
  domains/crm, domains/allocations) and add/amend ADRs — this reverses ADR 0019/0024 (link direction)
  and resolves the "soft vs hard allocation" open question in `allocations.md`.
