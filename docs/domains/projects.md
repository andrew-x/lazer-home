# Domain: Projects

**Status: growing (first slice).** Projects data, reads, a create flow, and the
`/projects` page all exist (create + read only — no edit/delete, mirroring
opportunities). This is the **hub linking CRM to delivery** and the first concrete
cut of the proposed **Allocation** concept (`project_roles`). The link *from* an
Opportunity *to* a Project (`projects.opportunityId`, [ADR 0019](../decisions/0019-project-opportunity-link.md))
is now **populated by a real handoff flow** ([ADR 0024](../decisions/0024-opportunity-project-handoff-and-placeholder-roles.md)):
a project can be created from an opportunity (via its detail drawer or the board's
delivery-stage prompt), and roles can be **placeholders/open positions** (null `staffId`)
carrying a `roleType`. Standalone projects (no opportunity, staffed roles) still work.
A project now carries a **required, project-level line of business** (the shared enum,
defaulted from its originating opportunity — no longer a per-role field), and creating
one requires **at least one role** ([ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
Built mirroring the Opportunities feature.

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
  **optional `opportunityId`** (nullable FK → `opportunities`, **`onDelete: restrict`**,
  index `projects_opportunity_idx`) — the CRM → delivery link, **1:N** (one opportunity →
  many projects; a project relates to at most one). Optional so a project can be created
  standalone; **restrict** mirrors `companyId`. **Now populated** by the handoff flow
  ([ADR 0024](../decisions/0024-opportunity-project-handoff-and-placeholder-roles.md)); the
  same-company invariant (linked opportunity's company == project's company) is still
  **not** server-enforced (the UI prefills + locks the company from the opportunity, but a
  hand-crafted request could mismatch — a future app-level check). See
  [ADR 0019](../decisions/0019-project-opportunity-link.md). Plus timestamps. Table
  `projects`, id prefix `proj`. Schema in `src/lib/db/projects-schema.ts` (barrelled by
  `src/lib/db/schema.ts`).
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
  - `startDate`/`endDate` (`date`, string mode, `"YYYY-MM-DD"`), `hoursPerDay`
    (`numeric(4,2)`, number mode, default `8`, allows half-days) — **all required on
    every role**, staffed or placeholder. (No `lineOfBusiness` — that's on the project.)
  - `projectId` → projects **cascade** (a role dies with its project). Indexed on both
    `projectId` and `staffId`.

  **This is the first concrete cut of the proposed Allocation entity** — see
  [allocations.md](./allocations.md), [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md),
  and [ADR 0024](../decisions/0024-opportunity-project-handoff-and-placeholder-roles.md).

## What's built

- **Schema** — `src/lib/db/projects-schema.ts` (`projects`, `project_delivery_managers`,
  `project_roles`), barrelled by `src/lib/db/schema.ts`; imports `opportunities` from
  `./opportunities-schema` (opportunities were split out of `crm-schema.ts` —
  [ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
  Migrations `drizzle/0015_premium_vertigo.sql`, `drizzle/0017_amused_corsair.sql` (adds the
  `projects.opportunityId` FK + index), `drizzle/0023_eager_demogoblin.sql` (adds the
  `project_role_type` enum; makes `project_roles.staff_id` nullable; adds `name` +
  `role_type`, backfilling existing rows to `ENGINEER` via a temporary default that's then
  dropped), and `drizzle/0024_harsh_diamondback.sql` (adds `projects.line_of_business` —
  backfilled to `CORE` via a temporary default then dropped, so it's NOT NULL with no
  default — **and drops `project_roles.line_of_business`**).
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
    a **grouped count** — no N+1.
  - `createProject.ts` — gated `projects.edit`. One `db.transaction`: inserts the
    project (setting `lineOfBusiness` and the optional `opportunityId`), then bulk-inserts
    delivery-manager junction rows (deduped so a repeat can't trip the `unique` index) and
    role rows (a null `staffId` ⇒ placeholder). The company must already exist (picked via
    search); the action only consumes ids. Revalidates **both** `/projects` and
    `/opportunities` (a linked project changes the board's `hasProject`).
  - `createProject.schema.ts` — the shared zod schema (pure, client-importable).
    Line-of-business values come from `@/lib/line-of-business`, role types from
    `@/lib/project-role-type`. **`lineOfBusiness` is a required top-level (project-wide)
    field**; accepts an optional `opportunityId`; **`roles` requires at least one**
    (`.min(1, "Add at least one role.")`). Per role: `staffId` optional (absent ⇒
    placeholder), optional `name`, **required `roleType`**, required dates/hours (no
    per-role line of business); each role `.refine`s `endDate >= startDate`; `hoursPerDay`
    is coerced, positive, ≤24.
  - `searchStaff.ts` / `searchCompanies.ts` — type-ahead pickers, gated
    **`projects.edit`** (so a delivery manager can staff a project without gaining CRM
    write access). Their query bodies are the **shared** `searchStaffByName` /
    `searchCompaniesByName` in `src/actions/shared/entitySearch.ts` — the identical
    query the CRM `searchStaff`/`searchCompanies` now also delegate to. Same query,
    separate permission gates per domain.
- **UI** — `/projects` (`src/app/(app)/projects/page.tsx`) + `src/components/projects/**` —
  see [../ui.md](../ui.md). `projects-table.tsx` (columns: Name, Company, Delivery
  managers, Roles count) and `add-project-dialog.tsx` (create form with a project-level
  line-of-business `EnumSelect` near the company field, plus a `useFieldArray` roles
  repeater **seeded with one empty role** so the "at least one role" requirement is
  obvious; each role row picks a **role type**, an optional staff member — blank ⇒
  placeholder — an optional name, dates, and hours, but **no line of business** — that's
  set once at the project level).
  **`AddProjectDialog` is parameterized** so one component serves three call sites: props
  `opportunityId`, `defaultCompanyId`/`defaultCompanyName`, `lockCompany` (pin the company
  to the opportunity's), **`defaultLineOfBusiness`** (pre-fills the project's line of
  business — the handoff passes the opportunity's, still editable), `onCreated`, and a
  controlled `open`/`onOpenChange`. Used on the
  projects page (self-triggered, own button), the opportunity detail drawer, and the
  board's delivery-stage prompt (prefilled + company-locked for that opportunity). A
  "Projects" nav entry (`IconBriefcase`) is in
  `src/components/app-shell/nav.ts`. New reusable components landed here:
  `src/components/crm/entity-combobox.tsx` (`EntityCombobox`, the single-select
  sibling of `EntityMultiCombobox`) and `src/components/form/enum-select.tsx`
  (`EnumSelect`, extracted from `add-opportunity-dialog.tsx` for reuse).
  `EntityCombobox` is used directly for a role's one staff member here, and is
  now the **shared single-select base** (with a `searchArgs` prop for extra,
  non-query search arguments like a `companyId` scope) that both `CompanyCombobox`
  and `ManagerComboboxField` wrap — see [../ui.md](../ui.md).

## Authorization

**Reads are open** — any signed-in user can browse all projects (the `(app)` gate is
the boundary). **All project writes** are gated by a single flat capability (no
ownership dimension): **`projects.edit`**, granted to `delivery-manager`, `manager`,
`admin`. It covers creating projects and their staffing, plus the two type-ahead
pickers that back entry (`searchStaff`/`searchCompanies` in `src/actions/projects/`).
The page hides its "Add project" dialog for users without the capability; the action
gate is the real boundary. See [permissions.md](./permissions.md).

## Key flows

- **Create a project + staff it** (built) — pick a company, set the project's **line of
  business**, add delivery managers, add **at least one** role line (role type + optional
  staff + optional name + date range + hours/day — no per-role line of business). Leaving
  staff blank creates a **placeholder / open position**. One transaction writes it all.
  Create only today.
- **Opportunity → Project handoff** (built) — a project is now created *from* an
  opportunity, setting `projects.opportunityId`, via two entry points: the opportunity
  **detail drawer** and the board's **delivery-stage prompt** (auto-opened when a card is
  dragged into Allocating+ with no project — see the `requiresProject` rule in
  [crm.md](./crm.md) and [ADR 0024](../decisions/0024-opportunity-project-handoff-and-placeholder-roles.md)).
  Both prefill and lock the company from the opportunity, and **prefill the project's line
  of business from the opportunity's** (still editable — the `defaultLineOfBusiness` prop,
  [ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
  The same-company invariant is
  enforced only in the UI, not the server (see above). Projects at the Allocating stage
  typically carry **placeholder roles** since staff aren't chosen yet. See
  [flows.md](../flows.md).

## Connects to

- **CRM** — every project belongs to a `companies` row (required FK, `restrict`), and may
  optionally link to an `opportunities` row (`opportunityId`, nullable FK, `restrict`,
  1:N). The Opportunity → Project handoff now **populates** that column
  ([ADR 0024](../decisions/0024-opportunity-project-handoff-and-placeholder-roles.md)), and
  the delivery-stage requirement (`requiresProject`) makes a project a precondition for
  advancing an opportunity past Scoping ([ADR 0019](../decisions/0019-project-opportunity-link.md)).
- **Staff** — delivery managers and (staffed) role staff are `staff` rows. Delivery-manager
  FKs cascade; a role's `staffId` is `restrict` and **nullable** (null ⇒ placeholder).
- **Allocations** — `project_roles` is the first concrete cut of the Allocation
  entity (see [allocations.md](./allocations.md), [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md)).
- **Timesheets / billing** — projects will be the thing time is logged against and
  billed for (proposed).

## Open questions / not yet built

- **Edit/delete** — only create + read exist. The `onDelete: restrict` on
  `projects.companyId`, `projects.opportunityId`, and `project_roles.staffId` means a
  company-, opportunity-, or staff-delete flow must handle live projects/roles.
- **Same-company invariant is UI-only** — the handoff now populates `opportunityId`, but
  nothing on the server guarantees the linked opportunity shares the project's company (the
  UI prefills + locks it). Add an app-level check in `createProject` ([ADR 0019](../decisions/0019-project-opportunity-link.md),
  [ADR 0024](../decisions/0024-opportunity-project-handoff-and-placeholder-roles.md)).
- **Placeholder roles can't be staffed yet** — a null-`staffId` role is created but there's
  no edit flow to later assign a person (or to fill in `name`/`roleType`). Comes with the
  project edit flow.
- **Roles are simple rows, not effective-dated history** — a role's dates/hours are
  edited in place (once edit exists), not versioned like `staff_employment`. See
  [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md). Full
  capacity planning (over/under-allocation, conflicts, forecast vs. actuals) is still
  in the Allocations domain's open questions.
- No project status/stage, no budget/value, no rates.
</content>
</invoke>
