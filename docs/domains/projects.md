# Domain: Projects

**Status: growing.** Projects data, reads, a create flow, and the `/projects` page all
exist. Projects are **create + top-level edit** (`updateProject` edits name, line of business,
status, and delivery managers — no company edit, no delete), plus **role CRUD via the
opportunity planner**. This is the **hub linking CRM to delivery** and the first concrete
cut of the proposed **Allocation** concept (`project_roles`).

The CRM → delivery link **inverted**: it no longer lives on `projects.opportunityId`
(removed) but on **`opportunities.projectId`** — a nullable FK, and now **many opportunities
→ one project** (a project can be built up from an original deal plus later extensions /
change requests), while an opportunity still has at most one project. See
[ADR 0019](../decisions/0019-project-opportunity-link.md) and
[ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md).

A project can be **created from** an opportunity (its detail drawer or the board's
delivery-stage prompt) or an opportunity can be **associated to an existing** project; roles
can be **placeholders/open positions** (null `staffId`) carrying a `roleType`. Standalone
projects (no opportunity, staffed roles) still work. Roles now carry a **planning `status`**
(`tentative` → `confirmed`) and an **`opportunityId` provenance FK**, edited through the
opportunity drawer's **weekly Gantt-like planner** ([ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)).
A project carries a **required, project-level line of business** (the shared enum, defaulted
from its originating opportunity — no longer a per-role field)
([ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
**Project creation is deliberately minimal** — the create dialog collects only **name,
company, and line of business**; roles and delivery managers are added **afterward in the
planner** (creation no longer requires a role). A project also carries a **lifecycle `status`**
(`tentative`/`confirmed`/`paused`/`cancelled`, defaulting to `tentative`) — set to `tentative`
at create and **editable afterward** via the planner's "Edit project" dialog
(`updateProject`), which also edits the project's name, line of business, and delivery
managers.

## Purpose

Track the billable engagements we deliver for a Company, and who is staffed on them
(delivery managers + role lines). Projects are where CRM (a won deal) will flow into
delivery, allocations, timesheets, and billing.

## Key entities

- **Project** (built) — billable work that **always belongs to a Company**. Fields:
  `name` (required), required `companyId` (FK → `companies`, **`onDelete: restrict`**
  — a company with live projects can't be deleted, exactly like `opportunities`),
  **required `lineOfBusiness`** (a **project-level** field, the shared `lineOfBusinessEnum`
  — which practice bills the engagement; NOT per-role, [ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)),
  **required `status`** (`projectStatusEnum`: `tentative`/`confirmed`/`paused`/`cancelled`,
  **NOT NULL, DB default `tentative`** — where the project sits in its lifecycle; its tuple +
  labels live in the pure, client-importable `src/lib/project-status.ts`, mirroring
  `line-of-business.ts`. Defaults to `tentative` at create and is **editable afterward** via
  the planner's Edit-project dialog (`updateProject`)),
  **The CRM → delivery link no longer lives here** — `projects.opportunityId` and its
  partial unique index were **removed** in the inversion. The link is now
  **`opportunities.projectId`** (nullable FK → `projects`, **`onDelete: restrict`**, indexed
  `opportunities_project_idx`), **many opportunities → one project**: a project can be built
  up from several deals, while an opportunity has at most one project (a single-valued FK).
  `restrict`: a project referenced by any opportunity can't be deleted (no project-delete flow
  yet). The **same-company invariant is now server-enforced** at the link entry points
  (`associateOpportunityProject` checks project.companyId == opportunity.companyId;
  `createProject` is same-company by construction; the `searchProjects` picker is
  company-scoped) — closing the long-standing gap. See
  [ADR 0019](../decisions/0019-project-opportunity-link.md) and
  [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md). Plus
  timestamps. Table `projects`, id prefix `proj`. Schema in `src/lib/db/projects-schema.ts`
  (barrelled by `src/lib/db/schema.ts`); it and `opportunities-schema.ts` now import each
  other via lazy `() => Table.id` refs (ESM-safe).
- **Project delivery managers** (built) — the staff who run a project. A **junction
  table** `project_delivery_managers` (many staff per project) following the CRM
  junction convention exactly ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)):
  surrogate `text` PK (`proj-dm`), a `unique(projectId, staffId)` for set-semantics,
  an `index` on `staffId` for reverse lookups, and **both FKs `onDelete: cascade`**.
- **Project role** (built) — a **staffing line**: a person (or an open position) of a
  given discipline for a date range at N hours/day. Table `project_roles`, id prefix
  `proj-role`. It carries **no line of business** — that lives on the project now
  ([ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
  **Not a pure junction** — it carries columns:
  - **`staffId` → staff, `restrict`, NULLABLE.** A **null `staffId` is a placeholder /
    open position** — a role defined before it's staffed (created by leaving the staff
    picker blank). `restrict` only bites a *staffed* role: deleting a person with live
    roles is blocked.
  - **`roleType`** (NOT NULL, `projectRoleTypeEnum`: `ENGINEER`/`DESIGNER`/`ARCHITECT`/`QA`/`SPECIALIST`)
    — the role's **discipline**, what identifies an open position when no person is set.
    **Orthogonal to the project's `lineOfBusiness`** (what kind of work vs. which practice bills it). Its
    tuple + labels live in the pure, client-importable `src/lib/project-role-type.ts`
    (mirrors `line-of-business.ts` — the pgEnum, zod, and form share one source).
  - **`name`** — optional free-text label, e.g. "Senior Backend Engineer".
  - **`status`** (NOT NULL, `projectRoleStatusEnum`: `tentative`/`confirmed`, **DB default
    `tentative`**) — the **planning state**: `tentative` while planned against an opportunity
    (editable in that opportunity's planner), `confirmed` once the opportunity is won (locked,
    read-only). Its tuple + labels live in the pure, client-importable
    `src/lib/project-role-status.ts` (single-source like `project-status.ts`).
  - **`opportunityId`** → opportunities, **`set null`**, **NULLABLE** — the **provenance**:
    which deal created this role. Used to scope who may edit it (only this opportunity's own
    tentative roles) and to grey out roles from other opportunities in a planner. Null for a
    role added to a standalone project; `set null` on delete keeps the role (its `projectId`
    still holds it). `status` + `opportunityId` are **server-controlled, never user input**.
  - `startDate`/`endDate` (`date`, string mode, `"YYYY-MM-DD"`), `hoursPerDay`
    (`numeric(4,2)`, number mode, default `8`, allows half-days) — **all required on
    every role**, staffed or placeholder. (No `lineOfBusiness` — that's on the project.)
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
  **Schema files are the source of truth for the current shape**: the squashed baseline
  `drizzle/0000_light_shape.sql` plus two incremental migrations
  (`drizzle/0001_wonderful_thing.sql` = the CRM timestamped-entries tables, unrelated to
  projects) and `drizzle/0002_loud_sister_grimm.sql` (the **link inversion** — drops
  `projects.opportunity_id` + its partial unique index, adds `opportunities.project_id`
  (FK `restrict`, indexed), and adds `project_roles.status` + `project_roles.opportunity_id`
  (FK `set null`, indexed) with the `project_role_status` enum; it **backfills** the inverted
  link and role provenance and confirms already-won roles before dropping the old column).
  The projects domain relies on: the `project_role_type` + `project_status` +
  `project_role_status` enums, a nullable `project_roles.staff_id` with `name`/`role_type`/
  `status`/`opportunity_id` (and **no** `project_roles.line_of_business` — line of business
  lives on `projects`), and the delivery link on `opportunities.project_id` (**not** on
  `projects` anymore).
- **Shared status module** — `src/lib/project-status.ts` exports the `PROJECT_STATUSES`
  tuple (`tentative`/`confirmed`/`paused`/`cancelled`), the `ProjectStatus` type,
  `DEFAULT_PROJECT_STATUS` (`tentative`), and `PROJECT_STATUS_LABELS`. A **pure,
  client-importable** module (no `db`/drizzle) so the `projectStatusEnum` pgEnum, the
  create-project zod schema, and the form share one source — the same single-source pattern
  as `line-of-business.ts` and `project-role-type.ts`.
- **Shared role-status module** — `src/lib/project-role-status.ts` exports
  `PROJECT_ROLE_STATUSES` (`tentative`/`confirmed`), the `ProjectRoleStatus` type,
  `DEFAULT_PROJECT_ROLE_STATUS` (`tentative`), and `PROJECT_ROLE_STATUS_LABELS`. A **pure,
  client-importable** module (no `db`/drizzle) so the `projectRoleStatusEnum` pgEnum, zod, and
  the planner UI share one source — the same single-source pattern as `project-status.ts`.
- **Shared role-type module** — `src/lib/project-role-type.ts` exports `PROJECT_ROLE_TYPES`
  (`ENGINEER`/`DESIGNER`/`ARCHITECT`/`QA`/`SPECIALIST`), the `ProjectRoleType` type, and
  `PROJECT_ROLE_TYPE_LABELS`. A **pure, client-importable** module (no `db`/drizzle) so the
  `projectRoleTypeEnum` pgEnum, the create-project zod schema, and the form share one
  source — the same single-source pattern as `line-of-business.ts`. Role type is a role's
  **discipline**, orthogonal to line of business.
- **Shared line-of-business module** — `src/lib/line-of-business.ts` exports the
  `LINE_OF_BUSINESS` tuple, the `LineOfBusiness` type, and `LINE_OF_BUSINESS_LABELS`.
  A **pure, client-importable** module (no `db`/drizzle) so the `lineOfBusinessEnum`
  pgEnum in `staff-schema.ts`, the projects zod schema, and the client form all share
  **one source of truth** — the same single-source pattern opportunities uses for its
  `source`/`status` enums ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)).
  Line of business is a **shared/global enum** carried by three entities — **staff**
  (`staff_employment`), **opportunities**, and **projects** (no longer `project_roles`,
  [ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
- **Server layer** — `src/actions/projects/`:
  - `getProjectsPage.ts` — server-only read (per [ADR 0010](../decisions/0010-actions-layer-owns-db-access.md)),
    server-side offset/limit pagination via `src/lib/pagination.ts` (same envelope as
    the CRM reads), `page` clamped into range. **Inner**-joins companies for
    `companyName` (company is required), resolves delivery-manager names via a
    **single grouped follow-up query** over just this page's ids, and role counts via
    a **grouped count** — no N+1. The projection now selects `projects.status` (typed
    `ProjectStatus` on `ProjectRow`).
  - `createProject.ts` — gated `projects.edit`. First, if an `opportunityId` is given, it
    checks `opportunityHasProject` (from `src/actions/crm/`) and throws a user-safe
    `"This opportunity already has a project."` (at most one project per opportunity). Then one
    `db.transaction`: inserts the project (setting `lineOfBusiness`, `status`), sets the
    **originating opportunity's `projectId`** (`.returning()`-guarded — a vanished opportunity
    rolls the whole create back), then bulk-inserts delivery-manager junction rows (deduped)
    and role rows — each tagged with the `opportunityId` (provenance) and created `tentative`
    (schema default), a null `staffId` ⇒ placeholder. Revalidates **both** `/projects` and
    `/opportunities` (a linked project changes the board's `hasProject`). **The action still
    accepts `roles`/`deliveryManagerIds`, but both now default to empty** — the create form
    sends none (they're added later in the planner), so in practice a fresh project starts
    role-less with no delivery managers.
  - `updateProject.ts` (+ `.schema.ts`) — **new**, gated `projects.edit` (mirrors
    `createProject`). Edits a project's **top-level fields only** — `name`, `lineOfBusiness`,
    `status`, and delivery managers — from the planner's Edit-project dialog. One
    `db.transaction`: updates the `projects` row, then **reconciles delivery managers with
    set-semantics** (delete all this project's `project_delivery_managers` rows, re-insert the
    deduped selection). **Roles are not touched here** — they have their own per-role planner
    actions. Revalidates `/projects` and `/opportunities` (a project's status/line of business
    shows on the opportunity planner too). This is the app's **first project-edit path**;
    role-level edits on a project are still only reachable via the tentative-role planner.
  - `createProject.schema.ts` — the shared zod schema (pure, client-importable). Its per-role
    shape is now the shared **`projectRole.schema.ts`** (`projectRoleFields` + the
    `endOnOrAfterStart` refinement), reused by `createProjectRole`/`updateProjectRole` too so
    the field rules live in one place. **`lineOfBusiness` required top-level**; a **`status`**
    (`z.enum(PROJECT_STATUSES).default("tentative")`); optional `opportunityId`;
    `deliveryManagerIds` defaults to empty; **`roles` defaults to empty** (`z.array(...)
    .default([])` — no longer `.min(1)`, so a project no longer needs a role at creation). Per
    role: `staffId` optional (absent ⇒ placeholder), optional `name`, required `roleType`,
    required dates/hours (`endDate >= startDate`; hours coerced, positive, ≤24).
    **`status`/`opportunityId` on a role are server-controlled, not in this input schema.**
    `updateProject.schema.ts` is a sibling: `projectId` + `name` + `lineOfBusiness` + `status`
    (all required) + `deliveryManagerIds` — no roles.
  - **Role CRUD (planner) — all gated `projects.edit`.** `createProjectRole` (adds a fresh
    tentative role/open position to the opportunity's project), `updateProjectRole` (edits an
    existing role's fields), `deleteProjectRole` (removes one), `extendProjectRole` (inserts a
    **new** tentative segment sharing a source role's `staffId`/`name`/`roleType` — the planner
    groups shared-staff rows into one person line, so an extension stacks as another block).
    Each derives the target project from the opportunity's `projectId` (a role can't be planted
    on an unrelated project); the mutating ones (`update`/`delete`) go through the shared
    **`assertRoleEditable`** guard: you may only edit a role that is **tentative** *and*
    **tagged with the current opportunity** (a data-integrity invariant on top of the RBAC
    gate, mirroring `assertOpportunityTransitionAllowed`). All revalidate `/opportunities` +
    `/projects`.
  - `associateOpportunityProject.ts` (+ `.schema.ts`) — link an opportunity to an **existing**
    project (the other half of the planner's empty state). **Gated `projects.edit`** (a delivery
    decision, though it writes an `opportunities` column). **Enforces the same-company invariant**
    (project.companyId == opportunity.companyId) and rejects an already-linked opportunity —
    this **closes** the long-deferred "same-company invariant is UI-only" gap
    ([ADR 0019](../decisions/0019-project-opportunity-link.md)).
  - `getOpportunityPlan.ts` — **server-only** read backing the planner: the opportunity's
    project meta (including **`deliveryManagers: {id,name}[]`**, a follow-up query joining
    `project_delivery_managers` → `staff` — surfaced on the planner's summary and prefilled into
    the Edit-project dialog) plus **every** role on it (across all opportunities), each carrying
    `status` + `opportunityId` so the client renders this opportunity's tentative roles editable
    and everything else (confirmed, or other opportunities') greyed. Also returns the overall
    timeline span and role count. Null only if the opportunity is unknown; no-project ⇒ empty
    plan.
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
  - **Role planning grid math** — `src/lib/project-planner-grid.ts` (+ `.test.ts`) is a **pure,
    client-importable** module (no `db`/React): `buildWeekColumns` (the ISO-Monday week spine),
    `buildPlannerRows` (groups roles into person-rows + placeholder rows, per-segment
    editability from the current opportunity id), `weekColumnLabel`, `weekSpan`. Mirrors
    `timesheet-grid.ts`; relies on the new `eachWeek(start, end)` in `timesheet-week.ts`.
  - **Auto-confirm on won** — `src/actions/crm/confirmRolesOnWon.ts` (server-only) flips every
    tentative role tagged with an opportunity to `confirmed` on a genuine transition into
    `closed_won`; wired into `updateOpportunityField`/`updateOpportunity`/`updateOpportunityPosition`
    inside their transactions. See [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)
    and [crm.md](./crm.md).
- **UI** — `/projects` (`src/app/(app)/projects/page.tsx`) + `src/components/projects/**` —
  see [../ui.md](../ui.md). `projects-table.tsx` (columns: Name, **Status**, Company, Delivery
  managers, Roles count — Status rendered by `project-status-badge.tsx`, a small
  `ProjectStatusBadge` mapping each status to a `Badge` variant: confirmed=default,
  tentative=secondary, paused=outline, cancelled=destructive) and `add-project-dialog.tsx`
  (a **deliberately minimal** create form collecting **only name, company, and a project-level
  line-of-business `EnumSelect`** — no status picker, no delivery-manager field, and **no roles
  repeater**. Status defaults to `tentative` and delivery managers/roles default to none
  server-side; all three are added afterward in the planner. The dialog's `FIELD_FOR_ISSUE`
  map still covers `status`/`deliveryManagerIds`/`roles` as harmless fallbacks so a schema
  field can't silently drop errors).
  **`AddProjectDialog` is parameterized** so one component serves three call sites: props
  `opportunityId`, `defaultCompanyId`/`defaultCompanyName`, `lockCompany` (pin the company
  to the opportunity's), **`defaultLineOfBusiness`** (pre-fills the project's line of
  business — the handoff passes the opportunity's, still editable), `onCreated`, and a
  controlled `open`/`onOpenChange`. Used on the
  projects page (self-triggered, own button), the opportunity detail drawer, and the
  board's delivery-stage prompt (prefilled + company-locked for that opportunity). A
  "Projects" nav entry (`IconBriefcase`) is in
  `src/components/app-shell/nav.ts`. New reusable components landed here:
  `src/components/form/entity-combobox.tsx` (`EntityCombobox`, the single-select
  sibling of `EntityMultiCombobox`) and `src/components/form/enum-select.tsx`
  (`EnumSelect`, extracted from `add-opportunity-dialog.tsx` for reuse).
  `EntityCombobox` is used directly for a role's one staff member here, and is
  now the **shared single-select base** (with a `searchArgs` prop for extra,
  non-query search arguments like a `companyId` scope) that both `CompanyCombobox`
  and `ManagerComboboxField` wrap — see [../ui.md](../ui.md).
- **Opportunity planner UI** — `src/components/crm/opportunity-project-plan.tsx` renders the
  opportunity drawer's **Project plan** tab as a **weekly Gantt-like planner** — effectively the
  project editor. A **summary** header shows the project's line of business, a **Delivery
  manager** card (from `getOpportunityPlan`'s `deliveryManagers`), and an **"Edit project"**
  button opening an **edit dialog** wired to the new `updateProject` action (name, line of
  business, status, delivery managers — roles are edited in the grid below, not here). Below
  that, summary StatCards (timeline length in weeks, role count) over a grid of roles × week
  columns (rows grouped by person; a filled cell = role active that week). This opportunity's
  tentative roles are **editable** (click a block to edit, Add role, Extend a role); confirmed
  roles and roles from other opportunities render **greyed/read-only**. The editable "this
  deal" blocks use the indigo **`bg-primary`** accent (recolored from `bg-secondary`) so they
  stand out against the read-only grey blocks and empty cells; the legend swatch matches. The
  empty state offers **associate an existing project** (`searchProjects` picker →
  `associateOpportunityProject`) or **create a new one** (`AddProjectDialog`). All write
  controls gated on `projects.edit`. The drawer sheet was widened to `sm:max-w-[64rem]`. Grid
  math is the pure `project-planner-grid.ts` (above).

## Authorization

**Reads are open** — any signed-in user can browse all projects (the `(app)` gate is
the boundary). **All project writes** are gated by a single flat capability (no
ownership dimension): **`projects.edit`**, granted to `delivery-manager`, `manager`,
`admin`. It covers creating projects and their staffing, **editing a project's top-level
fields** (`updateProject`), **all planner role CRUD**
(`createProjectRole`/`updateProjectRole`/`deleteProjectRole`/`extendProjectRole`),
**associating an opportunity to an existing project** (`associateOpportunityProject` — a
delivery decision even though it writes an `opportunities` column), and the type-ahead pickers
(`searchStaff`/`searchCompanies`/`searchProjects`). The interactive planner *read*
(`loadOpportunityPlan`) is gated `crm.edit` (it lives in the edit-only drawer); the underlying
`getOpportunityPlan` is server-only. On top of the RBAC gate, `assertRoleEditable` restricts
role edits to **this opportunity's own tentative roles**. No matrix change (`/audit-rbac`
clean). See [permissions.md](./permissions.md).

## Key flows

- **Create a project, then staff it** (built) — creation is minimal: pick a company and set
  the project's **line of business** (name too). The project starts `tentative` with **no roles
  and no delivery managers**. Staffing then happens **in the planner** (the opportunity
  drawer's Project plan tab): add role lines (role type + optional staff + optional name + date
  range + hours/day — no per-role line of business; leaving staff blank creates a **placeholder
  / open position**) and edit the project's name/status/line of business/delivery managers via
  the Edit-project dialog (`updateProject`).
- **Opportunity → Project handoff** (built) — an opportunity gets a project by **creating one
  from it** (setting `opportunities.projectId`) or **associating an existing one**
  (`associateOpportunityProject`). Create entry points: the opportunity **detail drawer** and
  the board's **delivery-stage prompt** (auto-opened when a card is dragged into Allocating+
  with no project — see the `requiresProject` rule in [crm.md](./crm.md) and
  [ADR 0024](../decisions/0024-opportunity-project-handoff-and-placeholder-roles.md)). Both
  prefill and lock the company from the opportunity, and prefill the project's line of business
  from the opportunity's (still editable). The **same-company invariant is now server-enforced**
  (associate checks it; create is same-company by construction). Projects at the Allocating
  stage typically carry **placeholder, tentative roles** since staff aren't chosen yet and the
  deal isn't won. See [flows.md](../flows.md).
- **Plan staffing against a deal** (built) — in the opportunity drawer's **Project plan** tab,
  add/edit/delete/extend **tentative roles** on the linked project via the weekly planner
  (scoped to this opportunity's own roles by `assertRoleEditable`). Roles **auto-confirm** when
  the opportunity is won ([ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)).

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
  (name, company, status, relationship labels) for the profile's Projects sub-section —
  the first staff→projects read in the app. See [staff-profiles.md](./staff-profiles.md).
- **Allocations** — `project_roles` is the first concrete cut of the Allocation entity, now
  with a soft/hard `status` (`tentative` → `confirmed`) (see [allocations.md](./allocations.md),
  [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md),
  [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)).
- **Timesheets / billing** — projects will be the thing time is logged against and
  billed for (proposed).

## Open questions / not yet built

- **Project edit is top-level-only; no delete** — `updateProject` now edits a project's
  **name, line of business, status, and delivery managers** (via the planner), and **roles**
  have full CRUD via the planner. Still **not editable**: the project's **company** (the FK is
  fixed after create), and there is **no project-delete flow**. The `onDelete: restrict` on
  `projects.companyId`, `opportunities.projectId`, and `project_roles.staffId` means a
  company-, project-, or staff-delete flow must handle live references. (Deleting an opportunity
  is `set null` on `project_roles.opportunityId` — the role survives but loses provenance.)
- ~~**Same-company invariant is UI-only**~~ **Resolved** — `associateOpportunityProject`
  enforces project.companyId == opportunity.companyId server-side, `searchProjects` is
  company-scoped, and `createProject` is same-company by construction. See
  [ADR 0019](../decisions/0019-project-opportunity-link.md).
- **Roles can only be edited via the opportunity planner** — a role (placeholder or staffed)
  can be edited through the drawer's planner only while it's **tentative and this
  opportunity's**, so a **confirmed** role (or one on a standalone project with no opportunity,
  or one owned by a different opportunity) can't be changed. `updateProject` edits project-level
  fields but never roles.
- ~~**Status can't be changed after creation**~~ **Resolved** — `updateProject` (planner
  Edit-project dialog) now moves a project between `tentative`/`confirmed`/`paused`/`cancelled`
  (and edits name, line of business, and delivery managers). What remains unchanged post-create
  is the project's **company**.
- **Roles are simple rows, not effective-dated history** — a role's dates/hours are
  edited in place (once edit exists), not versioned like `staff_employment`. See
  [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md). Full
  capacity planning (over/under-allocation, conflicts, forecast vs. actuals) is still
  in the Allocations domain's open questions.
- No budget/value, no rates. (A lifecycle `status` exists and is now editable post-create via
  `updateProject` — see above — but there's no richer pipeline/stage model.)
