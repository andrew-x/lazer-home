# Domain: Projects

**Status: growing.** Projects data, reads, create/edit/delete flows, the `/projects` list page,
and now a **per-project detail page** (`/projects/[id]`, the first single-project route — see
[Project detail page](#project-detail-page) below) all exist. This is the **hub linking CRM to
delivery** and the first concrete cut of the proposed **Allocation** concept (`project_roles`).

The CRM → delivery link lives on **`opportunities.projectId`** — a nullable FK, and **many
opportunities → one project** (a project can be built up from an original deal plus later
extensions / change requests), while an opportunity still has at most one project. See
[ADR 0019](../decisions/0019-project-opportunity-link.md) and
[ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md).

**A project stores almost nothing of its own** — just `id`, `name`, `companyId`, timestamps
(plus delivery-managers + roles relations). It carries **no stored `status` and no stored
`lineOfBusiness`**: both are **derived from its roles** by the pure module
`src/lib/projects/project-derived.ts` ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)).
Line of business is now a **per-role** field again; a role created from an opportunity
inherits that opportunity's LoB by default (still editable in the planner).

Roles carry a **planning `status`** — now **four states**
(`tentative`/`confirmed`/`paused`/`cancelled`; the last two are enum-only, no UI sets them
yet) — and an **`opportunityId` provenance FK**, edited through the opportunity drawer's
**weekly Gantt-like planner** ([ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)).
Roles can be **placeholders/open positions** (null `staffId`) carrying a `roleType`.
Standalone projects (no opportunity, staffed roles) still work.

**Two ways a project appears:** creating one **from** an opportunity is now **one-click, no
form** (`createProjectFromOpportunity` — inherits the opportunity's name + company, creates no
roles), or an opportunity can be **associated to an existing** project. The standalone
`AddProjectDialog` on `/projects` collects only **name + company**; roles and delivery
managers are added afterward in the planner. `updateProject` edits only **name + delivery
managers** (there is no status/LoB to edit — those derive). A project can also be **removed**
from an opportunity or **deleted** with the opportunity (see the detach flow below).

## Purpose

Track the billable engagements we deliver for a Company, and who is staffed on them
(delivery managers + role lines). Projects are where CRM (a won deal) will flow into
delivery, allocations, timesheets, and billing.

## Key entities

- **Project** (built) — billable work that **always belongs to a Company**. A project is
  **deliberately thin**: just `name` (required), required `companyId` (FK → `companies`,
  **`onDelete: restrict`** — a company with live projects can't be deleted, exactly like
  `opportunities`), and timestamps. Table `projects`, id prefix `proj`.
  - **No stored `status` and no stored `lineOfBusiness`.** Both were **dropped** and are now
    **derived from the project's roles** ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md);
    the old `project_status` pgEnum and `src/lib/project-status.ts` are **deleted**):
    - **Derived status** — `deriveProjectStatus(roleStatuses)` in `src/lib/projects/project-derived.ts`:
      no roles ⇒ `tentative`; all roles `cancelled` ⇒ `cancelled`; else over the *non-cancelled*
      roles, **least-committed wins** — any `tentative` ⇒ `tentative`, else any `paused` ⇒
      `paused`, else `confirmed`. So a project reads `confirmed` only once **all** its live
      roles are (exactly what `confirmRolesOnWon` produces on a win).
    - **Derived lines of business** — `deriveProjectLinesOfBusiness(roleLobs)`: the distinct
      per-role LoBs in canonical `LINE_OF_BUSINESS` order (a project can span practices now).
  - **The CRM → delivery link lives on the opportunity**, not here: **`opportunities.projectId`**
    (nullable FK → `projects`, **`onDelete: restrict`**, indexed `opportunities_project_idx`),
    **many opportunities → one project**: a project can be built up from several deals, while an
    opportunity has at most one project (a single-valued FK). `restrict` blocks deleting a
    project any opportunity references — the delete/detach flow nulls the link first (see
    [Delete / detach](#delete--detach) below). The **same-company invariant is server-enforced**
    at the link entry points (`associateOpportunityProject` checks project.companyId ==
    opportunity.companyId; `createProject`/`createProjectFromOpportunity` are same-company by
    construction; the `searchProjects` picker is company-scoped). See
    [ADR 0019](../decisions/0019-project-opportunity-link.md) and
    [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md). Schema in
    `src/lib/db/projects-schema.ts` (barrelled by `src/lib/db/schema.ts`); it and
    `opportunities-schema.ts` import each other via lazy `() => Table.id` refs (ESM-safe).
- **Project delivery managers** (built) — the staff who run a project. A **junction
  table** `project_delivery_managers` (many staff per project) following the CRM
  junction convention exactly ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)):
  surrogate `text` PK (`proj-dm`), a `unique(projectId, staffId)` for set-semantics,
  an `index` on `staffId` for reverse lookups, and **both FKs `onDelete: cascade`**.
- **Project role** (built) — a **staffing line**: a person (or an open position) of a
  given discipline for a date range at N hours/day. Table `project_roles`, id prefix
  `proj-role`. **Not a pure junction** — it carries columns:
  - **`staffId` → staff, `restrict`, NULLABLE.** A **null `staffId` is a placeholder /
    open position** — a role defined before it's staffed (created by leaving the staff
    picker blank). `restrict` only bites a *staffed* role: deleting a person with live
    roles is blocked.
  - **`lineOfBusiness`** (NOT NULL, the shared `lineOfBusinessEnum`) — which practice bills
    this staffing line. **Moved back onto the role** ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md));
    a project's set of LoBs is *derived* from its roles, so one project can span practices. A
    role created from an opportunity's planner **defaults to the opportunity's LoB** (the UI
    prefills it; still editable). Sourced from the pure `src/lib/crm/line-of-business.ts`.
  - **`roleType`** (NOT NULL, `projectRoleTypeEnum`: `ENGINEER`/`DESIGNER`/`ARCHITECT`/`QA`/`SPECIALIST`)
    — the role's **discipline**, what identifies an open position when no person is set.
    **Orthogonal to `lineOfBusiness`** (what kind of work vs. which practice bills it). Its
    tuple + labels live in the pure `src/lib/projects/project-role-type.ts`.
  - **`description`** — optional free-text label, e.g. "Senior Backend Engineer"
    (nullable text, max 200; **renamed from `name`** by `drizzle/0002_gifted_kylun.sql`).
  - **`status`** (NOT NULL, `projectRoleStatusEnum`, **DB default `tentative`**) — the
    **planning state**, now **four values**: `tentative` while planned against an opportunity
    (editable in that opportunity's planner), `confirmed` once the opportunity is won (locked,
    read-only), plus **`paused`/`cancelled`** for a role on hold or dropped. The last two are
    **enum-only for now** — no user-facing control sets them yet (the seed exercises them; the
    derivation + badges handle them). Its tuple, labels, and **badge variants** live in the
    pure `src/lib/projects/project-role-status.ts` — shared by the role badge *and* the derived
    `ProjectStatusBadge`.
  - **`opportunityId`** → opportunities, **`set null`**, **NULLABLE** — the **provenance**:
    which deal created this role. Used to scope who may edit it (only this opportunity's own
    tentative roles) and to grey out roles from other opportunities in a planner. Null for a
    role added to a standalone project; `set null` on delete keeps the role (its `projectId`
    still holds it). `status` + `opportunityId` are **server-controlled, never user input**.
  - `startDate`/`endDate` (`date`, string mode, `"YYYY-MM-DD"`), `hoursPerDay`
    (`numeric(4,2)`, number mode, default `8`, allows half-days) — **all required on
    every role**, staffed or placeholder.
  - `projectId` → projects **cascade** (a role dies with its project). Indexed on
    `projectId`, `staffId`, **and `opportunityId`**.

  **This is the first concrete cut of the proposed Allocation entity** — see
  [allocations.md](./allocations.md), [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md),
  and [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md).

## What's built

- **Schema** — `src/lib/db/projects-schema.ts` (`projects`, `project_delivery_managers`,
  `project_roles`), barrelled by `src/lib/db/schema.ts`; imports `opportunities` from
  `./opportunities-schema` (opportunities were split out of `crm-schema.ts` —
  [ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
  **Schema files are the source of truth for the current shape**; the drizzle history was
  squashed into a single baseline (`drizzle/0000_lethal_rictor.sql`) more than once, with
  three incremental migrations now on top — two of which touch this domain.
  `drizzle/0002_gray_corsair.sql` applied
  [ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md): it **adds**
  the `paused`/`cancelled` values to `project_role_status`, **adds** `project_roles.line_of_business`
  (backfilled from the parent project, then set NOT NULL), then **drops** `projects.status` +
  `projects.line_of_business` and the `project_status` type. `drizzle/0003_gifted_kylun.sql` then
  **renames** the role's optional label column `project_roles.name` → `description` (a single
  `RENAME COLUMN`; still nullable text, max 200 in the schema). The projects domain now relies on:
  the `project_role_type` + (four-state) `project_role_status` enums, a nullable
  `project_roles.staff_id` with `line_of_business`/`description`/`role_type`/`status`/`opportunity_id`,
  a `projects` table with **no `status`/`line_of_business` columns**, and the delivery link on
  `opportunities.project_id`.
- **Derived-fields module** — `src/lib/projects/project-derived.ts`
  exports `deriveProjectStatus(roleStatuses)` and `deriveProjectLinesOfBusiness(roleLobs)`. A
  **pure, client-importable** module (no `db`/drizzle) so every read, the UI, and tests share
  one implementation of the project's now-derived status/LoB. **Replaced the deleted
  `src/lib/project-status.ts`** ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)).
- **Shared role-status module** — `src/lib/projects/project-role-status.ts` exports
  `PROJECT_ROLE_STATUSES` (**four states**: `tentative`/`confirmed`/`paused`/`cancelled`),
  the `ProjectRoleStatus` type, `DEFAULT_PROJECT_ROLE_STATUS` (`tentative`),
  `PROJECT_ROLE_STATUS_LABELS`, **and `PROJECT_ROLE_STATUS_VARIANTS`** (badge variant per
  state: confirmed=default, tentative=secondary, paused=outline, cancelled=destructive). A
  **pure, client-importable** module (no `db`/drizzle) so the `projectRoleStatusEnum` pgEnum,
  zod, the planner UI, **and the derived `ProjectStatusBadge`** all share one source.
- **Shared role-type module** — `src/lib/projects/project-role-type.ts` exports `PROJECT_ROLE_TYPES`
  (`ENGINEER`/`DESIGNER`/`ARCHITECT`/`QA`/`SPECIALIST`), the `ProjectRoleType` type, and
  `PROJECT_ROLE_TYPE_LABELS`. A **pure, client-importable** module (no `db`/drizzle) so the
  `projectRoleTypeEnum` pgEnum, the create-project zod schema, and the form share one
  source — the same single-source pattern as `line-of-business.ts`. Role type is a role's
  **discipline**, orthogonal to line of business.
- **Shared line-of-business module** — `src/lib/crm/line-of-business.ts` exports the
  `LINE_OF_BUSINESS` tuple, the `LineOfBusiness` type, and `LINE_OF_BUSINESS_LABELS`.
  A **pure, client-importable** module (no `db`/drizzle) so the `lineOfBusinessEnum`
  pgEnum in `staff-schema.ts`, the projects/role zod schemas, and the client forms all share
  **one source of truth** — the same single-source pattern opportunities uses for its
  `source`/`status` enums ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)).
  Line of business is a **shared/global enum** carried by three entities — **staff**
  (`staff_employment`), **opportunities**, and **`project_roles`** (moved *back* onto the role;
  **no longer on `projects`**, whose LoBs are derived — [ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)).
- **Server layer** — `src/actions/projects/`:
  - `getProjectsPage.ts` — server-only read (per [ADR 0010](../decisions/0010-actions-layer-owns-db-access.md)),
    server-side offset/limit pagination via `src/lib/core/pagination.ts` (same envelope as
    the CRM reads), `page` clamped into range. **Inner**-joins companies for
    `companyName` (company is required), resolves delivery-manager names via a
    **single grouped follow-up query** over just this page's ids, and role counts via
    a **grouped count** — no N+1. It also fetches each page project's role **statuses +
    LoBs** (one grouped query) and computes `ProjectRow.status` + `ProjectRow.linesOfBusiness[]`
    via `deriveProjectStatus`/`deriveProjectLinesOfBusiness` — the project has no stored columns
    for these.
  - `getProjectPlan.ts` — **server-only** read backing the **project detail page**
    (`/projects/[id]`). A **project-keyed sibling of `getOpportunityPlan`**: it takes a
    `projectId`, joins the owning company (`company: {id,name}`, for the header link), and returns
    the `PlanProject` meta (with **derived `status` + `linesOfBusiness[]` + `deliveryManagers`**),
    **every** role on the project (all opportunities), the overall `timeline`, `roleCount`, and
    `externalAllocations` (the other-project commitments of everyone staffed here — same
    other-project / `tentative`|`confirmed` filter as the opportunity read). **Reuses the
    `PlanRole`/`PlanProject`/`ExternalAllocation` types from `getOpportunityPlan.ts`.** Unlike that
    read it has **no `editable`/`currentOpportunityId` notion** — the detail page is **read-only**.
    Returns **`null` when the project id is unknown**, so the page `notFound()`s.
  - `getProjectPto.ts` — **server-only** read backing the detail page's **Time off** tab.
    Aggregates PTO for **everyone connected to the project** — its staffed role assignees (`project_roles.staffId`)
    ∪ its delivery managers — into `{ upcoming, past, canSeeType }` (`endDate >= today` ⇒ upcoming
    soonest-first, else past most-recent-first; working-day counts via the shared
    `countWorkingDays`). **Permission nuance:** the tab is open to **anyone who can view the
    project** — every viewer sees the person, dates, and working-day count — but the **leave `type`
    and `isPending` state are gated on `pto.review`** and **masked in the read** (type → null,
    isPending → false) for non-reviewers. The `canSeeType` flag drives whether the client renders
    the Type column. Masking happens **in the read, never in the client**.
  - `createProjectFromOpportunity.ts` (+ `.schema.ts`) — **the one-click create from an
    opportunity** (no form), gated `projects.edit`. Inherits the opportunity's `name` +
    `companyId`, creates **no roles**, and sets `opportunities.projectId` under the atomic
    one-project-per-opportunity `isNull` guard (a concurrent link leaves 0 rows updated ⇒ throws
    ⇒ the insert rolls back, no orphan). Revalidates `/projects` + `/opportunities`. This backs
    the planner's empty-state "Create project" button and the board's delivery-stage confirm
    dialog. See [ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md).
  - `createProject.ts` (+ `.schema.ts`) — **standalone project create** (the `/projects`
    dialog), gated `projects.edit`. One `db.transaction`: inserts the project (name + company
    only), optionally links an `opportunityId` (same `isNull` guard as above), then bulk-inserts
    deduped delivery-manager rows and role rows — each role carries its own `lineOfBusiness`,
    is tagged with the `opportunityId` (provenance), created `tentative`, null `staffId` ⇒
    placeholder. **The action still accepts `roles`/`deliveryManagerIds`, both defaulting to
    empty** — the standalone form sends only name + company, so a fresh project starts
    role-less. Revalidates `/projects` + `/opportunities`.
  - `updateProject.ts` (+ `.schema.ts`) — gated `projects.edit`. Edits **only `name` +
    delivery managers** (there is no stored status/LoB to edit — those derive). One
    `db.transaction`: updates the `projects` row, then **reconciles delivery managers with
    set-semantics** (delete all rows, re-insert the deduped selection). **Roles are not touched
    here.** Revalidates `/projects` + `/opportunities`.
  - `removeProjectFromOpportunity.ts` (+ `.schema.ts`) — the planner's **"Remove project"**,
    gated `projects.edit`. Delegates to the shared `detachProjectFromOpportunity` helper (see
    [Delete / detach](#delete--detach)) and returns `{ deletedProject }` so the UI messages
    correctly. Revalidates `/projects` + `/opportunities`.
  - `detachProjectFromOpportunity.ts` — a **shared server-only helper** (not an action), the
    core of the detach flow, used by both `removeProjectFromOpportunity` and `deleteOpportunity`
    (in `src/actions/crm/`). See [Delete / detach](#delete--detach). Runs inside the caller's
    transaction; intentionally bypasses `assertRoleEditable` (bulk detach, not a single-role
    user edit).
  - `createProject.schema.ts` — the shared zod schema (pure, client-importable). It is now just
    `name`, `companyId`, optional `opportunityId`, `deliveryManagerIds` (default empty), and
    `roles` (default empty — no `.min(1)`). **No top-level `lineOfBusiness`/`status`.** The
    per-role shape is the shared **`projectRole.schema.ts`** (`projectRoleFields` +
    `endOnOrAfterStart`), reused by `createProjectRole`/`updateProjectRole`: per role `staffId`
    optional (absent ⇒ placeholder), **required `lineOfBusiness`** (planner defaults it to the
    opportunity's), optional `description`, required `roleType`, required dates/hours (`endDate >=
    startDate`; hours coerced, positive, ≤24). **`status`/`opportunityId` on a role are
    server-controlled, not in this input schema.** `updateProject.schema.ts` is a sibling:
    `projectId` + `name` + `deliveryManagerIds` only. `createProjectFromOpportunity.schema.ts`
    is just `{ opportunityId }`.
  - **Role CRUD (planner) — all gated `projects.edit`.** `createProjectRole` (adds a fresh
    tentative role/open position to the opportunity's project), `updateProjectRole` (edits an
    existing role's fields), `deleteProjectRole` (removes one), `extendProjectRole` (inserts a
    **new** tentative segment sharing a source role's `staffId`/`description`/`roleType`; each
    role is its own planner row, so an extension shows as a separate row for the same person —
    the source must be **confirmed** and on this opportunity's project, though it may belong to
    another opportunity). Each derives the target project from the opportunity's `projectId` (a
    role can't be planted on an unrelated project); the mutating ones (`update`/`delete`) go
    through the shared **`assertRoleEditable`** guard: you may only edit a role that is
    **tentative** *and* **tagged with the current opportunity** (a data-integrity invariant on
    top of the RBAC gate, mirroring `assertOpportunityTransitionAllowed`). All revalidate
    `/opportunities` + `/projects`.
  - **Bulk role actions (planner selection) — all gated `projects.edit`.** The planner's row
    checkboxes drive three batch actions over the selected editable roles, each taking
    `{ opportunityId, roleIds }` and running **`assertRoleEditable` per id inside one
    transaction** (a single non-editable id aborts the whole batch): **`deleteProjectRoles`**
    (bulk remove), **`duplicateProjectRoles`** (copies each role's *shape* — LoB, description,
    role type, dates, hours — as a fresh **tentative, unstaffed open position**, deliberately
    dropping the assigned `staffId`), and **`bumpProjectRoles`** (`+ weeks`: shifts each role's
    `startDate` **and** `endDate` by whole weeks via `addWeeks`, preserving duration; `weeks`
    may be negative to pull work earlier). Plus **`assignRoleStaff`** (`{ roleId, opportunityId,
    staffId }`, `staffId` nullable) — the inline "Assign staff…" picker on an editable unstaffed
    row; sets or clears the role's `staffId`. All are `secureActionClient`, gated `projects.edit`,
    guarded by `assertRoleEditable`, and revalidate `/opportunities` + `/projects`. **No RBAC
    matrix change** — they reuse the existing `projects.edit` capability.
  - `associateOpportunityProject.ts` (+ `.schema.ts`) — link an opportunity to an **existing**
    project (the other half of the planner's empty state). **Gated `projects.edit`** (a delivery
    decision, though it writes an `opportunities` column). **Enforces the same-company invariant**
    (project.companyId == opportunity.companyId) and rejects an already-linked opportunity —
    this **closes** the long-deferred "same-company invariant is UI-only" gap
    ([ADR 0019](../decisions/0019-project-opportunity-link.md)).
  - `getOpportunityPlan.ts` — **server-only** read backing the planner: the opportunity's
    `PlanProject` meta (including **derived `status` + `linesOfBusiness[]`** via
    `project-derived.ts`, and **`deliveryManagers: {id,name}[]`**, a follow-up query joining
    `project_delivery_managers` → `staff` — surfaced on the planner's summary and prefilled into
    the Edit-project dialog) plus **every** role on it (across all opportunities), each carrying
    `status` + `lineOfBusiness` + `opportunityId` so the client renders this opportunity's
    tentative roles editable and everything else (confirmed, paused/cancelled, or other
    opportunities') greyed. Also returns the overall timeline span and role count. Null only if
    the opportunity is unknown; no-project ⇒ empty plan. **It additionally returns
    `externalAllocations: ExternalAllocation[]`** — the **other-project commitments** of everyone
    staffed on this project: a second query over `project_roles` for those `staffId`s where the
    project is **not** this one and the status is `tentative`/`confirmed` (the allocations grid's
    filter), joined to `projects.name`. The planner greys these behind each staffed row's own
    load so an over-allocation is visible while planning the deal. Empty when no one is staffed.
  - `loadOpportunityPlan.ts` — the **interactive-read** `'use server'` wrapper (like
    `loadOpportunityDetail`), gated **`crm.edit`** because the planner lives in the edit-only
    drawer; write controls are separately `projects.edit`-gated per mutating action.
  - `searchProjects.ts` — type-ahead for the "associate an existing project" picker, gated
    **`projects.edit`**, **company-scoped** (`companyId` required — an opportunity can only
    link to a project of its own company, the same-company invariant enforced structurally).
  - `searchStaff.ts` / `searchCompanies.ts` — type-ahead pickers, gated
    **`projects.edit`** (so a delivery manager can staff a project without gaining CRM
    write access). Their query bodies are the **shared** `searchStaffByName` /
    `searchCompaniesByName` in `src/actions/shared/entitySearch.ts` — the identical
    query the CRM `searchStaff`/`searchCompanies` now also delegate to. Same query,
    separate permission gates per domain.
  - **Role planning grid math** — `src/lib/projects/project-planner-grid.ts` is a **pure,
    client-importable** module (no `db`/React): `buildWeekColumns(roles)` (the ISO-Monday week
    spine from earliest role start to latest role end), `buildPlannerRows(roles,
    externalAllocations, weekColumns, currentOpportunityId)`, and `weekColumnLabel`. It is now
    **role-centric — one `PlannerRow` per project role** (was one row per person with a person's
    roles grouped onto a line). Exported types: `PlannerRow` (`roleId`, `roleLabel`,
    `roleTypeLabel`, `hoursPerDay`, `status`, `editable`, `staffId`, `staffName`, `startDate`,
    `endDate`, `weeks`), `PlannerCell` (`{ own: OwnBlock | null; external: ExternalBlock[] }`),
    `OwnBlock` (this role's own % load for a week + start/end flags), and `ExternalBlock` (one of
    the assignee's other-project commitments in that week, greyed behind the own block). Per-row
    `editable` is derived from the `currentOpportunityId` (tentative + this opportunity). Rows sort
    **editable-first, then by start date, then staff name / role label**. It **reuses `weekPercent`
    from `@/lib/allocations/allocations-grid`** so both planners agree on a week's load;
    `weekColumnLabel` now renders the **full week range** (e.g. `"Aug 3 – Aug 9"`, was a single
    Monday date). Mirrors `timesheet-grid.ts`; relies on `eachWeek(start, end)` in
    `timesheet-week.ts`.
  - **Summary-tile helpers** — `src/lib/projects/plan-summary.ts` is a **pure, client-importable**
    module (no `db`/drizzle/React) holding `rangeOf` (min-start/max-end over dated items),
    `rangeLabel` (`"Aug 3 – Dec 12"`), `yearHint` (`"2026"` or `"2026–2027"`), and
    `deliveryManagerLabel` (comma-joined names or `"—"`). **Extracted out of
    `opportunity-project-plan.tsx`** so the opportunity Project-plan tab and the new project detail
    page render **identical summary stats from one source**.
  - **Auto-confirm on won** — `src/actions/crm/confirmRolesOnWon.ts` (server-only) flips every
    tentative role tagged with an opportunity to `confirmed` on a genuine transition into
    `closed_won`; wired into `updateOpportunityField`/`updateOpportunity`/`updateOpportunityPosition`
    inside their transactions. See [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)
    and [crm.md](./crm.md).
- **UI** — `/projects` (`src/app/(app)/projects/page.tsx`) + `src/components/projects/**` —
  see [../ui.md](../ui.md). `projects-table.tsx` (columns: Name, **Status**, Company, Delivery
  managers, Roles count — Status rendered by `project-status-badge.tsx`, whose `ProjectStatusBadge`
  now takes the **derived** `ProjectRow.status` and renders it via the shared four-state
  `PROJECT_ROLE_STATUS_LABELS`/`_VARIANTS`: confirmed=default, tentative=secondary,
  paused=outline, cancelled=destructive) and `add-project-dialog.tsx` (a **deliberately minimal**
  standalone create form collecting **only name + company** — no LoB/status picker, no
  delivery-manager field, no roles repeater. Delivery managers/roles default to none
  server-side; status/LoB are derived once roles exist).
  **`AddProjectDialog` serves the standalone `/projects` create button** (name + company). The
  **create-from-opportunity** paths no longer use it — the planner's empty state and the board's
  delivery-stage prompt call `createProjectFromOpportunity` directly (the board prompt is a
  **confirm dialog**, not the old form). A "Projects" nav entry (`IconBriefcase`) is in
  `src/components/app-shell/nav.ts`. Reusable form components used here:
  `src/components/form/entity-combobox.tsx` (`EntityCombobox`, the single-select base with a
  `searchArgs` prop for extra scope args, wrapped by `CompanyCombobox`/`ManagerComboboxField`)
  and `src/components/form/enum-select.tsx` (`EnumSelect`) — see [../ui.md](../ui.md).
- **Project detail page UI** — `src/app/(app)/projects/[id]/page.tsx` (Server Component) +
  `src/components/projects/detail/project-detail-view.tsx` (client). See
  [Project detail page](#project-detail-page) below and [../ui.md](../ui.md).
- **Opportunity planner UI** — `src/components/projects/opportunity-plan/` (entry
  `opportunity-project-plan.tsx`, split into `planner-grid.tsx` + `edit-project-dialog.tsx` +
  `role-dialog.tsx` + `extend-dialog.tsx`) renders the opportunity drawer's **Project plan** tab
  as a **weekly Gantt-like planner** — effectively the project editor. It lives under
  `components/projects/` (delivery UI) but is still **mounted inside the CRM opportunity detail
  sheet** (`components/crm/opportunity-detail-sheet.tsx`). A **summary** header shows the
  project's **derived** lines of business, an **"Edit project"** button opening an edit dialog
  wired to `updateProject` (**name + delivery managers only** — no status/LoB, since those
  derive; roles are edited in the grid below), and **"Remove project"**
  (`removeProjectFromOpportunity`). Below that, summary `StatCard` tiles: **Timeline** (length in
  weeks + derived project status), **Dates** (the overall `plan.timeline` start–end), **Roles**
  count, and **Delivery managers** — plus, **when any role is confirmed**, separate **Confirmed**
  and **Tentative** date-range tiles so the locked-in span reads apart from the proposed one.
  - **The grid is now role-centric: one row per role** (was one row per person). It has **two
    sticky lead columns — Role and Staff** — then a cell per week column. A filled `OwnBlock` = the
    role active that week, carrying its % of a 40-hour week; a **Staff** cell shows the assigned
    person's name, an inline `EntityCombobox` **"Assign staff…"** picker on editable unstaffed rows
    (wired to `assignRoleStaff`), or a dash. In each **staffed** row's week cells, the assignee's
    **other-project commitments** (from `getOpportunityPlan`'s `externalAllocations`) are greyed in
    behind the own block (project name + % + tooltip), mirroring the allocations grid's block style —
    surfacing over-allocation while planning.
  - **Selection + bulk actions.** Editable rows carry checkboxes (the vendored
    `src/components/ui/checkbox.tsx`); a header checkbox toggles all editable rows. When any are
    selected a **bulk bar** offers **Delete** (`deleteProjectRoles`), **Duplicate**
    (`duplicateProjectRoles` — copies as unstaffed open positions), and **Bump…** (a confirm
    dialog collecting a non-zero whole number → `bumpProjectRoles`, shifting start+end together).
  - This opportunity's tentative roles are **editable** (per-row Edit button, Add role, Extend a
    role — extend is **confirmed-roles only**); confirmed, paused/cancelled, and other
    opportunities' roles render **greyed/read-only**. Editable "this deal" blocks use the indigo
    `bg-primary` accent. The empty state offers **associate an existing project** (`searchProjects`
    → `associateOpportunityProject`) or **create a new one** (one-click
    `createProjectFromOpportunity`). All write controls gated on `projects.edit`. Grid math is the
    pure `project-planner-grid.ts` (above).

## Delete / detach

When a project's link to an opportunity is severed, `detachProjectFromOpportunity` (the shared
server-only helper) decides what to clean up, because a project can be **shared** by several
opportunities:

- **Sole owner** — every role on the project belongs to *this* opportunity **and** no other
  opportunity is linked to it **and** there are no unassigned/standalone roles ⇒ the **whole
  project is deleted** (roles + delivery managers cascade). This opportunity's `projectId` is
  nulled **first** so the FK `restrict` on `opportunities.projectId` doesn't block the delete.
- **Shared / mixed** — otherwise only **this opportunity's roles** are deleted and the
  opportunity is **unlinked** (`projectId = null`); the project and other opportunities' roles
  survive.

It runs inside the caller's transaction and **bypasses `assertRoleEditable`** (bulk detach, not
a single-role user edit). Two callers:

- **`removeProjectFromOpportunity`** (planner "Remove project", gated `projects.edit`).
- **`deleteOpportunity`** (in `src/actions/crm/`, gated `crm.edit` — the app's **first
  delete-opportunity flow**) runs the detach **before** deleting the opportunity row so role
  provenance (`projectRoles.opportunityId`) is still intact; the opportunity's junction/entry
  rows cascade.

See [ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md).

## Project detail page

`/projects/[id]` (`src/app/(app)/projects/[id]/page.tsx`) is the **first per-project detail
route** — previously the only in-depth single-project surface was the opportunity drawer's
Project-plan tab (keyed by `opportunityId`). The Server Component `Promise.all`s
`getProjectPlan(id)` + `getProjectPto(id)` (its `generateMetadata` also calls `getProjectPlan`
to title the tab), `notFound()`s when the plan is null (unknown id), and renders the client
`ProjectDetailView` (`src/components/projects/detail/project-detail-view.tsx`).

**Everything on this page is read-only** — role editing stays in the opportunity planner (see
[Open questions](#open-questions--not-yet-built)). **Cross-links into this route are now wired
across the app** (all via the canonical `InternalLink`, `src/components/internal-link.tsx`): the
`/projects` list Name cell (`projects-table.tsx`), the staff/own-profile Projects section
(`StaffProjectsSection`), the CRM company detail Projects & Referred-projects lists
(`company-detail-view.tsx`) and contact detail Referred-projects list (`contact-detail-view.tsx`),
the opportunity Project-plan tab heading (`opportunity-project-plan.tsx`), and the allocations grid
project cells (`allocations-grid.tsx`, opening in a new tab). The only project references still
left as plain text by design are the **editable timesheet week grid** row labels.

- **Header + summary tiles** — project name + derived `ProjectStatusBadge`, a company link
  (`/companies/[id]`), derived LoB badges, then the **same summary `StatCard` tiles** as the
  opportunity Project-plan tab (Length, Dates, Confirmed span, Tentative span, Delivery managers),
  rendered from the shared `plan-summary.ts` helpers so the two surfaces agree.
- **Three tabs:**
  - **Timeline** — a **read-only reuse of the opportunity planner's `PlannerGrid`**
    (`opportunity-plan/planner-grid.tsx`) fed by the pure `buildWeekColumns`/`buildPlannerRows`.
    Read-only is achieved by passing **`""` as the `currentOpportunityId`** so no role is marked
    editable (a real `opportunityId` can never be the empty string). It uses a **project-specific
    legend** (Confirmed / Tentative / Other project) instead of the opportunity planner's "This
    deal" legend.
  - **Roles** — all roles as a table (staffed first, then open/unstaffed placeholders shown as
    "Open role"), columns Staff · Role · Line of business · Status · Dates · Hrs/day.
  - **Time off** — the project's PTO from `getProjectPto`, split Upcoming / Past. The **Type
    column renders only for `pto.review` reviewers** (driven by `canSeeType`; see the read's
    permission nuance above).

## Authorization

**Reads are open** — any signed-in user can browse all projects, including the **detail
page** (`getProjectPlan`/`getProjectPto` are server-only; the `(app)` gate is the boundary).
**One field is masked, not gated:** the project detail page's Time off tab shows dates + who to
everyone but masks each leave's **type/pending state** unless the viewer has **`pto.review`**
(`getProjectPto` nulls those fields in the read — see [Project detail page](#project-detail-page)).
**All project writes** are gated by a single flat capability (no
ownership dimension): **`projects.edit`**, granted to `delivery-manager`, `manager`,
`admin`. It covers creating projects and their staffing (`createProject`,
**`createProjectFromOpportunity`**), **editing a project** (`updateProject` — name + delivery
managers), **removing a project from an opportunity** (`removeProjectFromOpportunity`), **all
planner role CRUD** (`createProjectRole`/`updateProjectRole`/`deleteProjectRole`/`extendProjectRole`),
**the bulk role actions + inline staff assignment**
(`deleteProjectRoles`/`duplicateProjectRoles`/`bumpProjectRoles`/`assignRoleStaff`),
**associating an opportunity to an existing project** (`associateOpportunityProject` — a
delivery decision even though it writes an `opportunities` column), and the type-ahead pickers
(`searchStaff`/`searchCompanies`/`searchProjects`). (**Deleting the opportunity itself** —
`deleteOpportunity`, which detaches the project — is a CRM write, gated `crm.edit`; see
[crm.md](./crm.md).) The interactive planner *read*
(`loadOpportunityPlan`) is gated `crm.edit` (it lives in the edit-only drawer); the underlying
`getOpportunityPlan` is server-only. On top of the RBAC gate, `assertRoleEditable` restricts
role edits to **this opportunity's own tentative roles**. No matrix change (`/audit-rbac`
clean). See [permissions.md](./permissions.md).

## Key flows

- **Create a standalone project, then staff it** (built) — creation is minimal: pick a company
  and a name (no LoB/status — those derive). The project starts with **no roles and no delivery
  managers** (so it reads `tentative` with no LoBs). Staffing then happens **in the planner**
  (the opportunity drawer's Project plan tab): add role lines (role type + line of business +
  optional staff + optional name + date range + hours/day; leaving staff blank creates a
  **placeholder / open position**) and edit the project's name/delivery managers via the
  Edit-project dialog (`updateProject`).
- **Opportunity → Project handoff** (built) — an opportunity gets a project by **creating one
  from it** — now **one-click** (`createProjectFromOpportunity`, inheriting name + company, no
  form) — or **associating an existing one** (`associateOpportunityProject`). Entry points: the
  opportunity **detail drawer's** Project-plan empty state and the board's **delivery-stage
  prompt** (a **confirm dialog** auto-opened when a card is dragged into Allocating+ with no
  project — see the `requiresProject` rule in [crm.md](./crm.md) and
  [ADR 0024](../decisions/0024-opportunity-project-handoff-and-placeholder-roles.md)). The
  **same-company invariant is server-enforced** (associate checks it; both create paths are
  same-company by construction). Roles are then added in the planner, each defaulting to the
  opportunity's line of business. See [flows.md](../flows.md) and
  [ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md).
- **Plan staffing against a deal** (built) — in the opportunity drawer's **Project plan** tab,
  add/edit/delete/extend **tentative roles** on the linked project via the weekly planner
  (scoped to this opportunity's own roles by `assertRoleEditable`), plus **bulk delete/duplicate/
  bump** on selected rows and **inline staff assignment** on unstaffed rows. Assigning someone
  greys their **other-project commitments** into the grid so over-allocation is visible. Roles
  **auto-confirm** when the opportunity is won
  ([ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)).

## Connects to

- **CRM** — every project belongs to a `companies` row (required FK, `restrict`). The
  opportunity link now lives on the **opportunity** side (`opportunities.projectId`, nullable
  FK, `restrict`, **many opportunities → one project**), populated by the handoff/planner flow
  ([ADR 0019](../decisions/0019-project-opportunity-link.md),
  [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)); the
  delivery-stage requirement (`requiresProject`) makes a project a precondition for advancing
  an opportunity past Scoping. `project_roles.opportunityId` records which deal created each
  role.
- **Staff** — delivery managers and (staffed) role staff are `staff` rows. Delivery-manager
  FKs cascade; a role's `staffId` is `restrict` and **nullable** (null ⇒ placeholder).
  The **reverse read** (which projects a person is on) lives in the staff domain:
  `getStaffProjects(staffId)` (`src/actions/staff/getStaffProjects.ts`) unions
  `project_roles.staffId` + `project_delivery_managers.staffId` into one row per project
  (name, company, **derived** status, relationship labels) for the profile's Projects
  sub-section — the status is computed via `deriveProjectStatus` (no stored column). See
  [staff-profiles.md](./staff-profiles.md).
- **Allocations** — `project_roles` is the first concrete cut of the Allocation entity, now
  with a soft/hard `status` (`tentative` → `confirmed`) (see [allocations.md](./allocations.md),
  [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md),
  [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)).
- **Timesheets / billing** — projects will be the thing time is logged against and
  billed for (proposed).

## Open questions / not yet built

- **Project edit is name + delivery managers only; company is fixed** — `updateProject` edits
  only those (there is no stored status/LoB to edit — both derive from roles), and **roles**
  have full CRUD via the planner. The project's **company** is fixed after create. A project
  *can* now be **deleted** (implicitly, via `removeProjectFromOpportunity`/`deleteOpportunity`
  when sole-owned — see [Delete / detach](#delete--detach)), but there is **no standalone
  project-delete action** on `/projects`. The `onDelete: restrict` on `projects.companyId`,
  `opportunities.projectId`, and `project_roles.staffId` still means a company-/staff-delete
  flow must handle live references.
- ~~**Same-company invariant is UI-only**~~ **Resolved** — `associateOpportunityProject`
  enforces project.companyId == opportunity.companyId server-side, `searchProjects` is
  company-scoped, and both create paths are same-company by construction. See
  [ADR 0019](../decisions/0019-project-opportunity-link.md).
- **Roles can only be edited via the opportunity planner** — a role (placeholder or staffed)
  can be edited through the drawer's planner only while it's **tentative and this
  opportunity's**, so a **confirmed** (or paused/cancelled) role, one on a standalone project
  with no opportunity, or one owned by a different opportunity can't be changed. `updateProject`
  never touches roles. The new **project detail page's Timeline tab is deliberately read-only**
  too — it reuses the planner grid purely for display (`currentOpportunityId = ""`).
- **`paused`/`cancelled` role states have no UI yet** — the enum values and their derivation
  (into the project's derived status) + badges exist, and the seed exercises them, but **no
  user-facing control sets a role to paused/cancelled**. Added when the planner grows role-state
  controls — no migration needed ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)).
- **Roles are simple rows, not effective-dated history** — a role's dates/hours are
  edited in place, not versioned like `staff_employment`. See
  [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md). Full
  capacity planning (over/under-allocation, conflicts, forecast vs. actuals) is still
  in the Allocations domain's open questions.
- No budget/value, no rates, no richer lifecycle/stage model beyond the derived status.
