# Domain: Projects

**Status: growing.** Projects data, reads, create/edit/delete flows, the `/projects` list page,
and a **per-project detail page** (`/projects/[id]`, the first single-project route) that is now
the **delivery-side editor of an engagement** (see [Project detail page](#project-detail-page)
below) all exist. This is the **hub linking CRM to delivery** and the first concrete cut of the
proposed **Allocation** concept (`project_roles`).

**Two editors, one set of rows.** A project's roles are edited from **two** surfaces with
**deliberately different invariants** ([ADR 0045](../decisions/0045-project-page-as-delivery-side-role-editor.md)):
the opportunity planner (**deal-side** — only *this* opportunity's still-`tentative` roles,
guarded by `assertRoleEditable`) and the project detail page (**delivery-side** — any role on
*this* project, including `confirmed` ones, guarded by `assertProjectRoleEditable`). Both carry
the same `projects.edit` RBAC gate. The old blanket claim "confirmed roles are locked" is now
true **only of the opportunity planner**.

The CRM → delivery link lives on **`opportunities.projectId`** — a nullable FK, and **many
opportunities → one project** (a project can be built up from an original deal plus later
extensions / change requests), while an opportunity still has at most one project. See
[ADR 0019](../decisions/0019-project-opportunity-link.md) and
[ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md).

**A project now carries its commercial terms** — `billingType` + `budgetAmount`/`budgetCurrency`
(and **nothing more**: a time-and-materials project bills at the company's **one standard rate
card, which lives in code**, not per project) — and the app computes **revenue, cost and margin**
over its roles ([Budget & margin](#budget--margin) below,
[ADR 0053](../decisions/0053-project-budgets-and-margin.md)). **Cost and margin are gated on the
new read capability `projects.viewMargin`; revenue is not** — a role's cost *is* an individual's
compensation, so this is the projects domain's first (and carefully masked) contact with
`staff_employment`.

**Otherwise a project stores little of its own** — `id`, `name`, `companyId`, the budget columns,
timestamps (plus delivery-managers + roles relations). It carries **no stored `status` and no
stored `lineOfBusiness`**: both are **derived from its roles** by the pure module
`src/lib/projects/project-derived.ts` ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)).
Line of business is now a **per-role** field again; a role created from an opportunity
inherits that opportunity's LoB by default (still editable in the planner).

Roles carry a **planning `status`** — now **four states**
(`tentative`/`confirmed`/`paused`/`cancelled`; the last two are enum-only, no UI sets them
yet) — and an **`opportunityId` provenance FK**, edited through the opportunity drawer's
**weekly Gantt-like planner** ([ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md))
**or the project detail page — from either its Roles table or its Timeline Gantt, both opening the
same dialog** ([ADR 0045](../decisions/0045-project-page-as-delivery-side-role-editor.md)).
Roles can be **placeholders/open positions** (null `staffId`) carrying a `roleType`.
Standalone projects (no opportunity, staffed roles) still work.

**Two ways a project appears:** creating one **from** an opportunity
(`createProjectFromOpportunity` — inherits the opportunity's name + company, creates no roles,
but **now asks for the budget**: it is a small dialog, no longer the one-click confirm it was
before [ADR 0053](../decisions/0053-project-budgets-and-margin.md)), or an opportunity can be
**associated to an existing** project. The standalone `AddProjectDialog` on `/projects` collects
**name + company + budget**; roles and delivery
managers are added afterward in the planner **or on the project detail page**. `updateProject`
(the planner's whole-record Edit dialog) edits **name + delivery managers**; the field-scoped
`updateProjectField` (the detail page's inline pencils) adds **company** to that — a project **can**
be re-parented to another client, guarded so the move can't strand a linked opportunity on someone
else's client (see the `updateProjectField` bullet under [What's built](#whats-built)). There is no
status/LoB to edit, those derive. The **budget is edited by neither** — it has its own action and
its own dialog (`updateProjectBudget` / `ProjectBudgetDialog`), shared by both surfaces, so
renaming a project never re-submits its price. A project can also be **removed**
from an opportunity or **deleted** with the opportunity (see the detach flow below).

## Purpose

Track the billable engagements we deliver for a Company, and who is staffed on them
(delivery managers + role lines). Projects are where CRM (a won deal) will flow into
delivery, allocations, timesheets, and billing.

## Key entities

- **Project** (built) — billable work that **always belongs to a Company**. `name` (required),
  required `companyId` (FK → `companies`,
  **`onDelete: restrict`** — a company with live projects can't be deleted, exactly like
  `opportunities`), **three budget columns** (below), and timestamps. Table `projects`, id prefix `proj`.
  - **Billing / budget** (`drizzle/0016_violet_whistler.sql`, [ADR 0053](../decisions/0053-project-budgets-and-margin.md)) —
    **`billingType`** (the new `project_billing_type` pgEnum: `FIXED_FEE` | `TIME_AND_MATERIALS`,
    values from the pure `src/lib/projects/project-billing.ts`), **`budgetAmount`**
    (`numeric(12,2)`, number mode) and **`budgetCurrency`** (the shared `currencyEnum`). **All
    three nullable, and `billingType: null` is a real permanent state** — every project that
    predates budgets has none, and the UI says "No budget set" rather than inventing a zero (the
    same "no target ≠ a target of nothing" rule as `compTargetAnnual`). Budget is **required in
    both create paths** going forward.
  - **`check("projects_budget_shape")`** makes the shape a DB invariant: *all three null*, **or**
    `FIXED_FEE` with amount **and** currency set, **or** `TIME_AND_MATERIALS` with **both null**
    (a T&M project has no total — it bills hours at the code-owned rate card). Mirrored by the zod
    **discriminated union** in `projectBudget.schema.ts`, so a half-written budget is
    *unrepresentable* at both ends. Every pre-existing row satisfies the first branch ⇒ **the
    migration needed no backfill.**
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
    construction; the `searchProjects` picker is company-scoped) **and, since the project's company
    became editable, at the one write that could break it after the fact** —
    `updateProjectField`'s `company` case refuses to re-parent a project while a linked opportunity
    belongs to a different company. Nothing else re-checks the invariant post-association, so that
    guard is load-bearing. See
    [ADR 0019](../decisions/0019-project-opportunity-link.md) and
    [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md). Schema in
    `src/lib/db/projects-schema.ts` (barrelled by `src/lib/db/schema.ts`); it and
    `opportunities-schema.ts` import each other via lazy `() => Table.id` refs (ESM-safe).
- **Project delivery managers** (built) — the staff who run a project. A **junction
  table** `project_delivery_managers` (many staff per project) following the CRM
  junction convention exactly ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)):
  surrogate `text` PK (`proj-dm`), a `unique(projectId, staffId)` for set-semantics,
  an `index` on `staffId` for reverse lookups, and **both FKs `onDelete: cascade`**.
- **Bill rates are NOT an entity.** There is **one company-wide rate card, in code** —
  `BILL_RATES` in `src/lib/projects/bill-rates.ts` — and a T&M project stores nothing about
  pricing at all.
  - ⚠️ **A `project_role_rates` table existed briefly on the branch and was dropped before
    shipping.** It was carried as an honest create-then-drop migration pair, but merging `main`
    renumbered those migrations anyway, so they were regenerated as a single
    `drizzle/0016_violet_whistler.sql` holding only the surviving columns. **No migration
    mentions the table** — [ADR 0053 §1–2](../decisions/0053-project-budgets-and-margin.md) is
    the only record it was tried.
  - A rate card is **policy**, revised centrally, not negotiated per engagement — and storing a
    copy per project invites two projects **silently disagreeing about what an engineer-hour is
    worth** for no product benefit. Don't reintroduce per-project rates as a field; that's a
    schema decision to reopen deliberately.
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
    (editable in that opportunity's planner), `confirmed` once the opportunity is won (**locked
    in the opportunity planner, but still editable from the project detail page** —
    [ADR 0045](../decisions/0045-project-page-as-delivery-side-role-editor.md)), plus
    **`paused`/`cancelled`** for a role on hold or dropped. The last two are
    **enum-only for now** — no user-facing control sets them yet (the seed exercises them; the
    derivation + badges handle them). Its tuple, labels, and **badge variants** live in the
    pure `src/lib/projects/project-role-status.ts` — shared by the role badge *and* the derived
    `ProjectStatusBadge`.
  - **`opportunityId`** → opportunities, **`set null`**, **NULLABLE** — the **provenance**:
    which deal created this role. Used to scope who may edit it **from a planner** (only this
    opportunity's own tentative roles) and to grey out roles from other opportunities there.
    Null for a role added to a standalone project **and for a role created from the project
    detail page** (that role belongs to the engagement, not to a deal); `set null` on delete
    keeps the role (its `projectId` still holds it). `status` + `opportunityId` are
    **server-controlled, never user input** — the project page's editor never rewrites either,
    so a role from a won deal keeps its provenance and its `confirmed` status even after
    delivery re-dates it. Conversely, editing a role that *does* carry an `opportunityId` from
    the project page **also changes that opportunity's plan** (an accepted consequence — the
    delete confirmation says so).
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
  `project_roles` — **three tables**), barrelled by `src/lib/db/schema.ts`; imports `opportunities` from
  `./opportunities-schema` (opportunities were split out of `crm-schema.ts` —
  [ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
  **Schema files are the source of truth for the current shape**; the drizzle history was
  squashed into a single baseline (`drizzle/0000_lethal_rictor.sql`) more than once, with
  six incremental migrations now on top (`0001`–`0006`) — two of which touch this domain.
  `drizzle/0002_gray_corsair.sql` applied
  [ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md): it **adds**
  the `paused`/`cancelled` values to `project_role_status`, **adds** `project_roles.line_of_business`
  (backfilled from the parent project, then set NOT NULL), then **drops** `projects.status` +
  `projects.line_of_business` and the `project_status` type. `drizzle/0003_gifted_kylun.sql` then
  **renames** the role's optional label column `project_roles.name` → `description` (a single
  `RENAME COLUMN`; still nullable text, max 200 in the schema). The projects domain now relies on:
  the `project_role_type` + (four-state) `project_role_status` enums, a nullable
  `project_roles.staff_id` with `line_of_business`/`description`/`role_type`/`status`/`opportunity_id`,
  a `projects` table with **no `status`/`line_of_business` columns** but **three budget
  columns + the `projects_budget_shape` CHECK** and the
  `project_billing_type` enum (`drizzle/0016_violet_whistler.sql`; there is **no rate-card
  table** — see the bill-rates bullet under
  [Key entities](#key-entities) and
  [ADR 0053](../decisions/0053-project-budgets-and-margin.md)), and the delivery link on
  `opportunities.project_id`.
- **Derived-fields module** — `src/lib/projects/project-derived.ts`
  exports `deriveProjectStatus(roleStatuses)` and `deriveProjectLinesOfBusiness(roleLobs)`, plus
  the list-section machinery: the **`ProjectStatusBucket`** type (`tentative` | `paused` |
  `active` | `past` | `cancelled` — the four derived statuses relabelled, except that **confirmed
  splits in two on the calendar**: tentative→tentative, paused→paused, cancelled→cancelled, and
  confirmed→**active** while it's still running or **past** once it's finished),
  **`PROJECT_STATUS_BUCKETS`** (all five in the order the list renders its sections — Tentative,
  Paused, Active, Past, Cancelled), **`projectHasEnded(endDate, today)`** (is the project's latest
  role end date before today — a project ending *today* still counts as running; zero-padded
  `"YYYY-MM-DD"` compares lexicographically), **`projectStatusBucket(status, endDate, today)`**
  mapping a derived status to its bucket, and **`statusesMatchBucket(bucket, roleStatuses, endDate,
  today)`** — a pure predicate that is the JS mirror of the SQL bucket filter (next bullet; paused
  bucket = ∃ a paused role ∧ ∄ a tentative role). A **pure,
  client-importable** module (no `db`/drizzle) so every read, the UI, and tests share one
  implementation of the project's now-derived status/LoB. **Replaced the deleted
  `src/lib/project-status.ts`** ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)).
- **Derived-status-in-SQL** — `src/lib/projects/project-status-sql.ts` (server-only) exports
  **`derivedStatusCondition(buckets, today)`**: correlated `EXISTS`/`NOT EXISTS` predicates that
  select projects by *derived-status bucket in the database*, so `getProjectsList` can paginate each
  section server-side instead of fetching every project and deriving in JS. Returns `undefined`
  for all five buckets (no filter — the flat filtered view) and a `false` guard for an empty
  selection; the `cancelled` bucket is defined as the **complement of the other three statuses**
  (`tentativeCondition`/`pausedCondition`/`confirmedCondition`) so the buckets always
  **partition** the set. `confirmedCondition` then splits on **`latestRoleEndDate`** — an exported
  correlated `max(project_roles.end_date)`, also the list's `endDate` sort key — into `active`
  (`not(ended)`) and `past` (`ended`, i.e. `< today::date`); confirmed guarantees ≥1 role, so that
  `max` is never null and the negation can't go three-valued. It **generalises the single-bucket
  `hasConfirmedProject` expression in `getCompaniesPage.ts`** (still the *status*-level predicate —
  a company with a delivered project is still a client) to all five buckets. **LOCKSTEP:** this SQL,
  its JS mirror `statusesMatchBucket`, and `deriveProjectStatus` then `projectStatusBucket` must all
  agree — guarded by the agreement test `src/lib/projects/project-derived.test.ts`, which enumerates
  all 16 role-status presence combinations × the end-date cases (none/past/today/future) and
  asserts, across **all five buckets**, both the SQL/JS
  mirror agreement and that the buckets partition. (A **sanctioned exception** to the one-test rule of
  [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md) — a cross-representation
  invariant the type system can't express.)
- **Shared role-status module** — `src/lib/projects/project-role-status.ts` exports
  `PROJECT_ROLE_STATUSES` (**four states**: `tentative`/`confirmed`/`paused`/`cancelled`),
  the `ProjectRoleStatus` type, `DEFAULT_PROJECT_ROLE_STATUS` (`tentative`),
  `PROJECT_ROLE_STATUS_LABELS`, **and `PROJECT_ROLE_STATUS_VARIANTS`** (badge variant per
  state: **confirmed=outline** (a neutral bordered tag — no indigo highlight, matching the
  line-of-business badges), tentative=secondary (muted filled grey), paused=outline,
  cancelled=destructive — so confirmed and paused share the `outline` look, disambiguated by
  label text). A
  **pure, client-importable** module (no `db`/drizzle) so the `projectRoleStatusEnum` pgEnum,
  zod, the planner UI, **and the derived `ProjectStatusBadge`** all share one source.
- **Shared role-type module** — `src/lib/projects/project-role-type.ts` exports `PROJECT_ROLE_TYPES`
  (`ENGINEER`/`DESIGNER`/`ARCHITECT`/`QA`/`SPECIALIST`), the `ProjectRoleType` type, and
  `PROJECT_ROLE_TYPE_LABELS`. A **pure, client-importable** module (no `db`/drizzle) so the
  `projectRoleTypeEnum` pgEnum, the create-project zod schema, and the form share one
  source — the same single-source pattern as `line-of-business.ts`. Role type is a role's
  **discipline**, orthogonal to line of business.
  - It also exports **`STAFF_ROLE_FOR_PROJECT_ROLE_TYPE`** — the `staff_employment.role` each
    project role type corresponds to, used to cost an **open** role from the company-wide average
    for that discipline. Four map 1:1; **`SPECIALIST` maps to `null`** (the catch-all discipline
    has no staff-role counterpart), so the caller falls back to averaging *every billable*
    discipline. Keep the `Role` import **`import type`** — `projects-schema.ts` imports this module
    for **values** (the pgEnum), and `staff-enums` reads its unions out of `staff-schema.ts`, so a
    value import would close a runtime cycle through the schema (same caveat as
    `compensation-targets.ts`).
- **Shared billing-type module** — `src/lib/projects/project-billing.ts` exports `BILLING_TYPES`
  (`FIXED_FEE`/`TIME_AND_MATERIALS`), the `BillingType` type and `BILLING_TYPE_LABELS`. **Pure,
  client-importable**, so the `projectBillingTypeEnum` pgEnum, the zod discriminated union, and the
  dialogs' labels share one source ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)).
- **The rate card (code as policy — the whole of it)** — `src/lib/projects/bill-rates.ts`:
  **`BILL_RATES`** (a **total** map over `PROJECT_ROLE_TYPES` — every discipline must have a rate,
  unlike the `Partial` `COMP_TARGETS`), **`BILL_RATE_CURRENCY`** (one currency for the whole card),
  `BILL_RATES_REVIEWED_ON`, **`standardRateCard()`** (the rows in canonical order, *derived* from
  `BILL_RATES` so the form can't show a rate the margin math doesn't use) and
  **`isFlatRateCard()`** (lets the UI say "225/hr for every discipline" in one line instead of five
  identical rows). It is **not** a set of defaults copied anywhere — it **is** the card every T&M
  project bills at. Rates are **policy**, revised centrally by human judgement, so they live in
  code (a review, not a migration), and one shared card means two projects can't disagree about
  what an engineer-hour is worth — the `compensation-targets.ts` /
  [ADR 0042](../decisions/0042-per-role-subratings-app-owned-jsonb.md) precedent. ⚠️ **The shipped
  numbers are a flat 225 USD placeholder**, not our real rate card.
- **Margin math** — `src/lib/projects/project-margin.ts` (+ `project-margin.test.ts`, 22 tests — a
  sanctioned [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md) exception, same
  grounds as `compensation-plan.test.ts`). **Pure and client-importable**, so the server read and
  the client's currency toggle share one implementation. See
  [Budget & margin](#budget--margin) below for the rules it encodes.
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
  - `getProjectsList.ts` — the server-only read (per [ADR 0010](../decisions/0010-actions-layer-owns-db-access.md))
    backing `/projects`, **replacing the deleted `getProjectsPage.ts` + its `ProjectRow`**.
    Exports **`ProjectListItem`** (the prior fields — id, name, derived `status`,
    `linesOfBusiness[]`, company, delivery-manager names, role count — **plus a `startDate`/`endDate`
    string range** aggregated from the project's roles, null when role-less),
    **`ProjectsListFilters`** (`{ query?, lineOfBusiness?, deliveryManagerId? }` — a
    case-insensitive substring match on project **or** company name, a single line of business,
    and a single delivery manager: a `staff.id` matched via a **correlated `EXISTS` on
    `project_delivery_managers`**), and two functions over a shared `assembleRows` helper:
    - **`getProjectsInBuckets(buckets, filters?)`** — every project in the given derived-status
      buckets (via `derivedStatusCondition`), ordered by name, **non-paginated** — backs the full
      Tentative, Paused and Active sections.
    - **`getProjectsPage(page, buckets, filters?, pageSize?, order?)`** — one page (offset/limit
      + a `count`, `page` clamped, the `Page<T>` envelope from `pagination.ts`), the filter
      `where` applied to **both** the count and the row query so the page count reflects the
      filtered set. **`order: ProjectsListOrder`** (`"name"` | `"endDate"`, default `"name"`)
      sets the sort: `endDate` orders by a **correlated `max(project_roles.end_date)`
      descending, `nulls last`** (latest-ending project first, role-less projects last — the date
      range is derived, not a column, and the expression is the shared `latestRoleEndDate`), with
      `name` as the stable tiebreaker. Backs the name-ordered Cancelled section, the
      `endDate`-ordered Past section (most recently finished first) **and** the flat filtered view,
      which the page also requests with `"endDate"`.
      The `where` also decides the active/past split from **`currentDay()`**, read once per call —
      the one clock read in the loader.
    Both **inner**-join companies for `companyName` (required); `assembleRows` then resolves
    delivery managers, role statuses/LoBs, role count, and the min-start/max-end date range in
    **two grouped follow-up queries** scoped to the page's ids — **no N+1**. `status` +
    `linesOfBusiness` are derived in JS via `deriveProjectStatus`/`deriveProjectLinesOfBusiness`;
    the date range exploits `"YYYY-MM-DD"` being zero-padded (lexicographic min/max ==
    chronological). Also exports **`getDeliveryManagerOptions()`** →
    `DeliveryManagerOption[]` (`{ id, name }`) — the distinct, name-ordered staff who are a
    delivery manager on ≥1 project, the option set for the list's delivery-manager filter.
  - `getProjectPlan.ts` — **server-only** read backing the **project detail page**
    (`/projects/[id]`). A **project-keyed sibling of `getOpportunityPlan`**: it takes a
    `projectId`, joins the owning company (`company: {id,name}`, for the header link), and returns
    the `PlanProject` meta (with **derived `status` + `linesOfBusiness[]` + `deliveryManagers`**),
    **every** role on the project (all opportunities), the overall `timeline`, `roleCount`, and
    `externalAllocations` (the other-project commitments of everyone staffed here — same
    other-project / `tentative`|`confirmed` filter as the opportunity read). **Reuses the
    `PlanRole`/`PlanProject`/`ExternalAllocation` types from
    `getOpportunityPlan.ts`**, and like it returns **`costBasis` + `exchangeRates`** (see the
    `getOpportunityPlan` bullet). Unlike that
    read it has **no `editable`/`opportunityId` notion**: per-role editability on the
    project page isn't a property of the *read* — every role on the project is editable by a
    `projects.edit` holder (the page's `canEdit` flag drives the affordances; the actions carry
    the gate), which the client expresses by passing `{ scope: "project" }` to `buildPlannerRows`.
    Returns **`null` when the project id is unknown**, so the page `notFound()`s.
  - `getProjectPto.ts` — **server-only** read backing the detail page's **Time off** tab.
    Aggregates PTO for **everyone connected to the project** — its staffed role assignees (`project_roles.staffId`)
    ∪ its delivery managers — into `{ upcoming, past, canSeeType }` (`endDate >= today` ⇒ upcoming
    soonest-first, else past most-recent-first; working-day counts via the shared
    `countWorkingDays`). **Permission nuance (tightened — was a leak):** the tab is open to
    **anyone who can view the project** — every viewer sees the person, dates, and working-day
    count — but the **leave `type` and `isPending` state are gated on `pto.review`** and
    **masked in the read** (type → null, isPending → false) for non-reviewers. The `canSeeType`
    flag drives whether the client renders the Type column. Masking happens **in the read, never
    in the client**.
    - **Non-reviewers now get approved leave only.** The query adds
      `eq(staffPto.isPending, false)` for viewers without `pto.review`. Previously *pending*
      (unapproved) leave was returned to everyone with `isPending` forced to `false`, so an
      unapproved — possibly to-be-rejected — request read as settled time off. Reviewers still
      see pending spans (they plan around requests before approval). This matches the
      allocations grid, which has always shown approved PTO only.
    - **The read fails closed with no session** (`getCurrentUser()` null ⇒ empty spans,
      `canSeeType: false`) rather than leaning on the `(app)` layout's redirect.
  - `createProjectFromOpportunity.ts` (+ `.schema.ts`) — **create from an
    opportunity**, gated `projects.edit`. Its input is now `{ opportunityId, budget }` — the
    project still inherits the opportunity's `name` +
    `companyId` (so the dialog asks only how the work bills), creates **no roles**, and sets
    `opportunities.projectId` under the atomic
    one-project-per-opportunity `isNull` guard (a concurrent link leaves 0 rows updated ⇒ throws
    ⇒ the insert rolls back, no orphan). Revalidates `/projects` + `/opportunities`. This backs
    the planner's empty-state "Create project" button and the board's delivery-stage prompt —
    **both now a budget dialog, not a one-click confirm**
    ([ADR 0053](../decisions/0053-project-budgets-and-margin.md)). See
    [ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md).
  - `createProject.ts` (+ `.schema.ts`) — **standalone project create** (the `/projects`
    dialog), gated `projects.edit`. One `db.transaction`: inserts the project (name + company
    + the budget columns), optionally links an `opportunityId` (same `isNull` guard as above), then bulk-inserts
    deduped delivery-manager rows and role rows — each role carries its own `lineOfBusiness`,
    is tagged with the `opportunityId` (provenance), created `tentative`, null `staffId` ⇒
    placeholder. **The action still accepts `roles`/`deliveryManagerIds`, both defaulting to
    empty** — the standalone form sends only name + company, so a fresh project starts
    role-less. Revalidates `/projects` + `/opportunities`.
  - `updateProject.ts` (+ `.schema.ts`) — the **whole-record** edit behind the planner's
    Edit-project dialog, gated `projects.edit`. Edits **only `name` + delivery managers** (there
    is no stored status/LoB to edit — those derive). One `db.transaction`: updates the `projects`
    row, then **reconciles delivery managers with set-semantics** (delete all rows, re-insert the
    deduped selection). **Roles are not touched here.** Now revalidates via the shared
    **`revalidateProject`** — it previously hit only `/projects` + `/opportunities`, missing the
    detail route and `/allocations` entirely. Its schema exports the shared **`projectName`**
    rule, reused by `updateProjectField`'s `name` variant so the dialog and the inline field
    can't drift.
  - `updateProjectField.ts` (+ `.schema.ts`) — the **field-scoped** edit behind the detail page's
    inline pencils, gated `projects.edit`. A **discriminated union on `field`** — **`name` |
    `company` | `deliveryManagers`** — mirroring `updateCompanyField`: each variant writes **only its
    own slice**, so a name save can't clobber a concurrent delivery-manager edit and doesn't rewrite
    the junction. `name` is a `.returning()`-guarded update (`assertRowExists`);
    `deliveryManagers` re-runs the same set-semantics reconcile inside a transaction that first
    proves the project exists. **Status and lines of business are deliberately not fields** — both
    derive from roles. Schema is **pure/client-importable** so the inline components share it.
    - **The `company` variant re-parents a project — with a guard worth knowing about.**
      `associateOpportunityProject` enforces that an opportunity and its project share a company,
      and **nothing re-checks that after association**. So the `company` case runs in a transaction
      that proves the target company exists and then **refuses with a `UserSafeActionError` naming
      the offending opportunity** if any opportunity linked to this project belongs to a different
      company ("unlink or move that opportunity before changing the project's company"). Moving a
      project therefore can't strand a deal on someone else's client — this is the **third**
      enforcement point of the same-company invariant, next to `associateOpportunityProject` and the
      company-scoped `searchProjects` ([ADR 0019](../decisions/0019-project-opportunity-link.md)).
    - It revalidates **`revalidateProject`** *plus* **`revalidateCompany` for both the old and the
      new company** (`src/actions/crm/revalidate.ts`) — a company detail page lists the projects it
      owns (`getCompanyDetail`), so the project has to disappear from one and appear on the other.
    - **Logged time is *not* stranded by a move.** `timeEntries.projectId` references the **project**
      (`src/lib/db/timesheets-schema.ts`), not the company, so hours already booked follow the
      project to its new client. That's a **billing-attribution** consequence — past time now reads
      against the new client — not an FK problem.
  - **Budget writes** ([ADR 0053](../decisions/0053-project-budgets-and-margin.md)):
    - `projectBudget.schema.ts` — the budget half of **all three** write paths (both creates +
      the update). A **pure, client-importable** zod **discriminated union on `billingType`**
      mirroring the `projects_budget_shape` CHECK: `FIXED_FEE` ⇒ `budgetAmount` +
      `budgetCurrency`; **`TIME_AND_MATERIALS` ⇒ `z.object({ billingType })` and nothing else** —
      it bills at the code-owned card, so **picking the billing type is the whole decision**. One
      non-obvious rule: `budgetAmount` is `.positive()` **because `z.coerce.number()` turns a blank
      input's empty string into 0**, so without it an untouched field would silently save a $0
      budget instead of failing with a message.
    - `projectBudgetWrite.ts` — one server-only helper, `projectBudgetColumns(budget)`, shared by
      those three actions (**nothing here authorizes**; each caller carries its own `projects.edit`
      gate). It returns the three columns with
      **explicit nulls on the T&M branch** — load-bearing on update, since switching away from a
      fixed fee must *clear* the total or the CHECK rejects the write. **There is nothing else to
      write**: a T&M project stores no rates.
    - `updateProjectBudget.ts` (+ `.schema.ts`) — **re-price a project**: set a budget on one that
      predates budgets, or switch billing model. Gated **`projects.edit`** (seeing the resulting
      *margin* is the separate `projects.viewMargin` read capability). **A dedicated action, not a
      field on `updateProject`**, which owns name + delivery managers and re-sends everything it
      holds: folding the budget in would make a rename re-submit the project's price — the
      last-write-wins clobbering `updateProjectField` exists to avoid. **One statement, no
      transaction** — a single `UPDATE ... RETURNING`, which doubles as the existence check (the
      returned-nothing case throws "That project no longer exists", so there's no separate
      `assertRowExists` pre-read), and switching to T&M clears the fee in the same `set`.
      Revalidates via `revalidateProject`.
  - **Cost basis reads** (the compensation-touching half —
    [ADR 0053](../decisions/0053-project-budgets-and-margin.md)):
    - `src/actions/shared/staffHourlyCost.ts` — **what an hour of someone's time costs.**
      `hourlyCostOf(row)` takes an hourly worker's `hourlyRate` as-is and restates a salaried
      person's annual `base` hourly via **`convertCompUnit` / the flat `HOURS_PER_YEAR`
      convention** — deliberately **not** scaled by `utilizationTarget`, so the same salary always
      yields the same hourly cost and a project's margin doesn't move when a utilization target is
      revised. **Bonuses excluded** (`base` is the committed number).
      `getStaffHourlyCosts(ids)` is two queries + a JS fold over `latestEmploymentFirst` +
      `firstPerKey` (the ADR 0007 effective-dated shape, no N+1); somebody with no employment row
      is simply **absent** from the map. `getRoleTypeAverageCostsUsd(rates)` averages active staff
      per discipline **in USD** (so the client's currency toggle needs no re-read *and* no
      individual amount ever leaves the server); `SPECIALIST` pools every **billable** role
      (`isBillableRole` — leadership/sales/ops salaries are overhead and would drag a delivery cost
      basis); a role type with **no matching staff is absent, never 0**.
      ⚠️ **Everything this module produces is compensation-derived — never call it directly from a
      reader; go through `getProjectCostBasis`.**
    - `getProjectCostBasis.ts` — **the one place the `projects.viewMargin` decision is made**, and
      it lives **in the read**. Returns `PlanCostBasis` or **`null`**, and `null` *is* "may not see
      margin" (one signal, not a parallel boolean that could drift into a payload saying "not
      allowed" while carrying the numbers). It returns **before touching `staff_employment` at
      all**, and it **masks rather than throws** (the plan is the whole page — the same choice
      `getProjectPto` makes for the leave type). A null user falls through to a default-deny role.
      See [Authorization](#authorization).
  - **Role CRUD (project detail page) — all gated `projects.edit`.**
    `createProjectRoleOnProject`, `updateProjectRoleOnProject`, `deleteProjectRoleOnProject`
    (+ a `.schema.ts` each, all reusing the shared `projectRoleFields`/`endOnOrAfterStart` from
    `projectRole.schema.ts`). The **delivery-side counterparts** of the planner's
    `createProjectRole`/`updateProjectRole`/`deleteProjectRole`: keyed by **`projectId`**, not by
    an opportunity. Create inserts with **`opportunityId: null` and `status: "tentative"`** (the
    role belongs to the engagement, not a deal; status stays system-driven). Update/delete run
    **`assertProjectRoleEditable`** in a transaction and never touch `status`/`opportunityId`.
    All revalidate via `revalidateProject`. See
    [ADR 0045](../decisions/0045-project-page-as-delivery-side-role-editor.md).
  - `assertProjectRoleEditable.ts` — the **delivery-side** business guard (server-only, not an
    action): the role must exist and `role.projectId === projectId`. **That is the whole
    invariant** — no status check, no opportunity check — because a live engagement's roles are
    `confirmed` precisely *because* the deal was won, and delivery legitimately has to re-date
    them, move hours and swap assignees. Scoping by `projectId` is the containment. It returns
    the role's `opportunityId` so callers can warn that a destructive edit also changes that
    opportunity's plan. **It is not a bypass of the stricter `assertRoleEditable`** — read both
    docstrings before touching either; precedent for a non-opportunity-scoped role write predates
    both (`allocateStaffToRole` re-dates and staffs confirmed open roles by `roleId` alone).
    Keep `assertRoleEditable` strict.
  - `revalidate.ts` — **`revalidateProject(projectId)`**, the shared post-write revalidation for
    this domain (mirroring CRM's `revalidateCompany`/`revalidateContact`): `/projects`,
    `/projects/[id]`, `/opportunities`, **and `/allocations`** — project roles *are* the
    allocations grid's rows. Because status + LoBs derive from roles in the same read, one call
    refreshes the badge, the LoB row, the timeline and the summary tiles together.
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
    through the shared **`assertRoleEditable`** guard — the **deal-side** invariant: you may only
    edit a role that is **tentative** *and* **tagged with the current opportunity** (a
    data-integrity invariant on top of the RBAC gate, mirroring
    `assertOpportunityTransitionAllowed`). **Keep it strict** — the project page's laxer
    `assertProjectRoleEditable` (below) is the sanctioned delivery-side path, not a reason to
    relax this one. All revalidate `/opportunities` + `/projects`.
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
    - **It also carries the money** ([ADR 0053](../decisions/0053-project-budgets-and-margin.md)):
      `PlanProject.budget` is a **`PlanBudget`** — just the three columns
      (`billingType` + `budgetAmount`/`budgetCurrency`), **no rate card**, since the client imports
      the one card from `bill-rates.ts` — plus top-level **`costBasis: PlanCostBasis | null`** (null
      ⇒ the viewer
      lacks `projects.viewMargin`) and **`exchangeRates`** (the USD table + its `asOf`/`stale`
      provenance, so the client converts — and can *name* the rates it used — without a refetch;
      `FxRateNote` renders both the rate and its freshness from this —
      [ADR 0029](../decisions/0029-external-fx-rates-and-currency-normalization.md)). Rates are
      fetched **up front** so every early-return path (`emptyPlan()`) carries them; the fetch is a
      12h-cached `fetch` that never throws, so that's effectively free.
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
    spine from earliest role start to latest role end), **`buildPlannerRows(roles,
    externalAllocations, weekColumns, editability)`**, and `weekColumnLabel`. It is
    **role-centric — one `PlannerRow` per project role** (was one row per person with a person's
    roles grouped onto a line). Exported types: `PlannerRow` (`roleId`, `roleLabel`,
    `roleTypeLabel`, `hoursPerDay`, `status`, **`editable`**, **`emphasized`**, `staffId`,
    `staffName`, `startDate`, `endDate`, `weeks`), `PlannerCell`
    (`{ own: OwnBlock | null; external: ExternalBlock[] }`),
    `OwnBlock` (this role's own % load for a week + start/end flags), and `ExternalBlock` (one of
    the assignee's other-project commitments in that week, greyed behind the own block). Rows sort
    **staffed-first, then by staff name, then role-type label, then start date** (so a person's
    roles sit together). It **reuses `weekPercent`
    from `@/lib/allocations/allocations-grid`** so both planners agree on a week's load;
    `weekColumnLabel` renders the **full week range** (e.g. `"Aug 3 – Aug 9"`). Mirrors
    `timesheet-grid.ts`; relies on `eachWeek(start, end)` in `timesheet-week.ts`.
    - **`RoleEditability` — the exported discriminated union** that tells the module which of the
      two editors it is feeding: `{ scope: "opportunity"; opportunityId }` (only *that* deal's
      `tentative` rows are editable) or `{ scope: "project" }` (**every** role is editable). It
      **replaced a `currentOpportunityId: string` parameter**, and with it the old
      "pass `""` so nothing is editable" sentinel — don't reintroduce that trick.
    - **`editable` vs. `emphasized` are two different questions**, split apart when the project
      timeline became an edit surface. `editable` = may the viewer edit this row. `emphasized` =
      render as "this deal's own line" (**opportunity scope only** — on the project page every row
      belongs to the project, so nothing is emphasised). `planner-grid.tsx`'s `ownBlockClass` keys
      the indigo emphasis fill off **`emphasized`**; keying it off `editable` would give every row on
      the project timeline that fill and **collapse the confirmed-vs-tentative colouring** the
      project legend documents into one colour.
    - **`project-planner-grid.test.ts`** (5 tests) pins both scopes and exactly that regression —
      the module had **no** test before, despite its docstring claiming unit-testability. Another
      sanctioned exception to the one-test rule of
      [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md), on the same grounds as
      `project-derived.test.ts`: a cross-representation invariant (grid flags ↔ two surfaces' rules)
      the type system can't express.
  - **Summary-tile helpers** — `src/lib/projects/plan-summary.ts` is a **pure, client-importable**
    module (no `db`/drizzle/React) holding `rangeOf` (min-start/max-end over dated items),
    `rangeLabel` (`"Aug 3 – Dec 12"`), `yearHint` (`"2026"` or `"2026–2027"`), and
    `deliveryManagerLabel` (comma-joined names or `"—"`). **Extracted out of
    `opportunity-project-plan.tsx`** so the opportunity Project-plan tab and the new project detail
    page render **identical summary stats from one source**.
  - **Auto-confirm on won** — `src/actions/crm/confirmRolesOnWon.ts` (server-only) flips every
    tentative role tagged with an opportunity to `confirmed` on a genuine transition into
    `closed_won`; wired into `updateOpportunityField`/`updateOpportunityPosition`
    inside their transactions. See [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)
    and [crm.md](./crm.md).
- **UI** — `/projects` (`src/app/(app)/projects/page.tsx`) + `src/components/projects/**` —
  see [../ui.md](../ui.md). The list is now a **responsive grid of project cards, not a table**
  (the old `projects-table.tsx`/`ProjectRow` were **deleted**). `project-card.tsx` (`ProjectCard`)
  is a clickable `Card` linking to `/projects/[id]`, showing name + company, the derived
  `ProjectStatusBadge` (still `project-status-badge.tsx` over the four-state
  `PROJECT_ROLE_STATUS_LABELS`/`_VARIANTS`: confirmed=outline, tentative=secondary,
  paused=outline, cancelled=destructive) + derived LoB badges, delivery managers, and the role
  date range (`formatDateRange` from `src/lib/format/format.ts`). `projects-grid.tsx` exports
  `ProjectsGrid` (the grid) + `ProjectsSection` (a titled section with a count, optionally a
  **closed-by-default disclosure**). The page **groups projects by derived-status bucket into five
  sections in `PROJECT_STATUS_BUCKETS` order — Tentative → Paused → Active → Past → Cancelled**:
  **only Active is open and un-collapsed**, so the page lands on the work in flight; Tentative,
  Paused, Past and Cancelled are collapsed disclosures that keep their counts visible. Tentative,
  Paused and Active render in full (`getProjectsInBuckets`), while **Past and Cancelled are
  server-paginated** (`getProjectsPage`) since they grow without bound — each on **its own page
  param** (`pastPage` / `cancelledPage`, preserved independently by `buildListHref`) so they page
  separately, and each **re-opens when its own param is past page 1**, since following a page link
  is a fresh server render that would otherwise snap the section shut. `projects-list-filters.tsx`
  (`ProjectsListFilters`) is a **URL-backed** filter bar — a debounced project-OR-company search
  (`q`) + a line-of-business `SelectFilter` (`lob`) + a **delivery-manager
  `SearchableSelectFilter` (`dm`, fed `getDeliveryManagerOptions`, validated against the known
  ids, hidden when there are no delivery managers)** — the shared **searchable single-select**
  (`src/components/form/filters.tsx`) for long option sets like staff — the same
  `buildListHref`/`PaginationControls` pattern as the
  opportunities/companies/contacts lists, with the search box + its debounce-to-URL effect coming
  from the shared `useUrlSearchFilter`/`SearchFilter` (`src/components/form/search-filter.tsx`; see
  [../ui.md](../ui.md#list-filter-bars)). **When any of the three filters is active the sections collapse
  into a single flat, paginated grid across all statuses, ordered by end date descending**
  (latest-ending first, role-less projects last — via `getProjectsPage`'s `"endDate"` order),
  rather than the name-ordered sections; clearing filters restores the sections. `add-project-dialog.tsx` (a **deliberately minimal**
  standalone create form collecting **name + company + budget** — no LoB/status picker, no
  delivery-manager field, no roles repeater. Delivery managers/roles default to none
  server-side; status/LoB are derived once roles exist).
  **`AddProjectDialog` serves the standalone `/projects` create button.** The
  **create-from-opportunity** paths use their own `CreateProjectFromOpportunityDialog` (name +
  company are inherited, so it collects **only** the budget) from the planner's empty state and the
  board's delivery-stage prompt — **which is why that prompt is no longer a `ConfirmDialog`**
  ([ADR 0053](../decisions/0053-project-budgets-and-margin.md)).
  A "Projects" nav entry (`IconBriefcase`) is in
  `src/components/app-shell/nav.ts`. Reusable form components used here:
  `src/components/form/entity-combobox.tsx` (`EntityCombobox`, the single-select base with a
  `searchArgs` prop for extra scope args, wrapped by `CompanyCombobox`; the CRM
  contact-relationship dialog is the other `searchArgs` consumer)
  and `src/components/form/enum-select.tsx` (`EnumSelect`) — see [../ui.md](../ui.md).
- **Project detail page UI** — `src/app/(app)/projects/[id]/page.tsx` (Server Component) +
  `src/components/projects/detail/` — `project-detail-view.tsx` (client) plus the editing pieces
  `project-name-field.tsx`, **`project-company-field.tsx`**, `delivery-managers-field.tsx`,
  `use-project-inline-save.ts` and
  `project-role-dialog.tsx`. See [Project detail page](#project-detail-page) below and
  [../ui.md](../ui.md).
- **Shared role form fields** — `src/components/projects/role-fields.tsx` exports `RoleFields`
  (line of business, role type, description, staff picker, dates, hours), `RoleFormValues`,
  `ROLE_ISSUE_FIELDS` and `roleDefaultValues(existing, defaultLineOfBusiness)`. **Extracted out of
  `opportunity-plan/role-dialog.tsx`** so the planner dialog and the project page's
  `ProjectRoleDialog` can't drift — the client-side mirror of the server-side shared
  `projectRoleFields`. **`status` is deliberately absent** (system-driven, never a form field).
- **Budget UI** (`src/components/projects/`, [ADR 0053](../decisions/0053-project-budgets-and-margin.md)):
  - **`budget-fields.tsx`** — the form fragment behind **all three** budget editors (deliberately
    the mirror of `role-fields.tsx`): a billing-type picker plus a fee + currency.
    `BudgetFormValues` is just `{ billingType, budgetAmount, budgetCurrency }`. **Both modes'
    fields exist at all times** so switching billing type doesn't discard typed input;
    `toBudgetInput` drops the fee on the T&M branch, so a phantom total can never reach the server.
    Its issue map is
    keyed by `AllKeys<ProjectBudgetInput>` rather than `keyof` — plain `keyof` on a discriminated
    union yields only the discriminant, which would let the map omit the fee fields.
    - **T&M renders a read-only `StandardRateCard` panel**, not an editable grid: there is nothing
      to decide, and *showing* the rates is the point — it's what makes "time & materials" a
      priced choice rather than a blank cheque. Built from `BILL_RATES` (via `isFlatRateCard()` /
      `standardRateCard()`), so **a rate revision surfaces here without anyone touching the
      form**, captioned "Company-wide and set in code, not per project — last reviewed
      {`BILL_RATES_REVIEWED_ON`}".
  - **`budget-dialog.tsx`** (`ProjectBudgetDialog`) — set/edit a budget, wired to
    `updateProjectBudget`. Its own dialog rather than fields bolted onto the planner's
    Edit-project dialog (that one is name + delivery managers and carries a destructive "Remove
    project"), and the detail page has no such dialog at all — one shared dialog is the only way
    both surfaces get the identical affordance.
  - **`budget-summary-panel.tsx`** (`BudgetSummaryPanel`) — Revenue / Cost / Margin with a
    **CAD↔USD `ToggleGroup`**, the **`FxRateNote`** immediately left of it, the billing badge, and
    the edit affordance. Mounted on **both** the
    opportunity Project-plan tab and the project detail page (above its tabs). A **bordered panel,
    not more `StatCard`s**: the money shouldn't sit in the same undifferentiated wrap as the date
    tiles, and the panel header gives the toggle, the rate note, the badge and the edit button
    somewhere to live (its local `BudgetFigure` borrows `StatCard`'s typography without its `Card`,
    with `value` as a **node** so the margin can carry its loss colouring).
    **Cost and Margin render only when the server sent a cost basis**; revenue always shows.
    **The Margin figure leads with the money amount, with the percentage as its hint line** — what
    the plan earns is the decision; the rate is how to read it. The T&M revenue hint reads
    "*N* hrs · standard rate card". Two honesty notices remain: no roles yet, and roles with no comp
    on record (cost partial). The **unpriced-role and mixed-currency notices are gone** with the
    per-project card — one total card in one currency makes both states unrepresentable.
  - **`plan-summary-tiles.tsx`** — a pure extraction of the Length/Dates/Confirmed/Tentative/
    Delivery-managers tile row **both** plan surfaces had duplicated.
  - **`use-project-margin.ts`** — the client hook owning the display currency and calling
    `computeProjectMargin`, so a surface's panel and its grid can never disagree. Conversion happens
    **client-side** from the native amounts + shipped rate table, so the toggle never refetches
    ([ADR 0029](../decisions/0029-external-fx-rates-and-currency-normalization.md)). The currency is
    lazily defaulted by `resolveDisplayCurrency` and then owned by the toggle — it deliberately
    doesn't re-derive when the budget changes, so re-pricing doesn't move it under you.
  - Two new **app-wide** atoms came out of this: **`src/components/fx-rate-note.tsx`**
    (`FxRateNote({ rates, from, to })` — **one** muted line stating the rates the panel's figures
    were converted at, rendered beside the currency selector that caused the conversion; one
    currency renders its rate inline (`1 USD = 1.37 CAD`), several summarise as "Converted at
    today's rates" with the pairs in the tooltip, and it renders **`null`** when nothing was
    converted) and
    **`src/components/inline-notice.tsx`** (the hairline notice strip, extracted from the two
    open-coded timesheet banners, which were migrated onto it). See [../ui.md](../ui.md).
- **Opportunity planner UI** — `src/components/projects/opportunity-plan/` (entry
  `opportunity-project-plan.tsx`, split into `planner-grid.tsx` + `edit-project-dialog.tsx` +
  `role-dialog.tsx` + `extend-dialog.tsx`) renders the opportunity drawer's **Project plan** tab
  as a **weekly Gantt-like planner** — effectively the project editor. It lives under
  `components/projects/` (delivery UI) but is still **mounted inside the CRM opportunity detail
  sheet** (`components/crm/opportunity-detail/sheet.tsx`). A **summary** header shows the
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
  - **Per-role money is a third line in the sticky label cell**, driven by one optional
    **`margins`** prop (`{ byRoleId, currency }`) — so "off" (no budget, or no
    `projects.viewMargin`) is a single `undefined` rather than several flags. It carries **no FX
    affordance of its own** (that lives once in the panel header), and it is **always led by the
    amount**, matching the panel: `"CA$8,000 margin"` when both sides are known, else the **cost**
    (a fixed fee, where revenue isn't attributable per role), else the **revenue** — which is what a
    viewer without `projects.viewMargin` gets. A cancelled role reads "Excluded from budget"; a role
    with nothing true to say (unpriced, no visible cost) renders **nothing** rather than an em dash,
    since the panel already counts it. The tooltip carries hours, the breakdown, the **percentage**,
    **and where the cost came from**, so an averaged figure never reads as a real person's pay.
    **Deliberately not
    a new column:** `PLANNER_SUB_LABEL_COL`'s `sticky left-56` is hand-twinned to
    `PLANNER_LABEL_COL` and those widths are **shared with the allocations grid**, so a third
    sticky column would shift the week spine on every planner
    ([ADR 0053](../decisions/0053-project-budgets-and-margin.md)).
  - **Selection + bulk actions.** Editable rows carry checkboxes (the vendored
    `src/components/ui/checkbox.tsx`); a header checkbox toggles all editable rows. When any are
    selected a **bulk bar** offers **Delete** (`deleteProjectRoles`), **Duplicate**
    (`duplicateProjectRoles` — copies as unstaffed open positions), and **Bump…** (a confirm
    dialog collecting a non-zero whole number → `bumpProjectRoles`, shifting start+end together).
  - This opportunity's tentative roles are **editable** (per-row Edit button, Add role, Extend a
    role — extend is **confirmed-roles only**); confirmed, paused/cancelled, and other
    opportunities' roles render **greyed/read-only**. "This deal" blocks use the indigo
    `bg-primary` accent — driven by `PlannerRow.emphasized`, which in this scope coincides with
    `editable` but is a **separate flag** (the project timeline sets `editable` without it; see the
    `project-planner-grid.ts` bullet above).
    The empty state offers **associate an existing project** (`searchProjects`
    → `associateOpportunityProject`) or **create a new one** (`CreateProjectFromOpportunityDialog`
    → `createProjectFromOpportunity`, which asks for the budget). All write controls gated on
    `projects.edit`. Grid math is the pure `project-planner-grid.ts` (above).

## Budget & margin

The commercial layer, added by [ADR 0053](../decisions/0053-project-budgets-and-margin.md) — read
that for the *why* behind each rule below. Math lives in the pure
`src/lib/projects/project-margin.ts`; the schema is in [Key entities](#key-entities).

- **Revenue.** A **fixed fee** is the `projects` total, converted once — and it is **project-level
  only**: per-role `revenue` is `null`, because apportioning one price across roles would invent a
  number. A **T&M** role's revenue is `hours × BILL_RATES[roleType]` in `BILL_RATE_CURRENCY`, and the
  project's is the sum over its counted roles. `computeProjectMargin` takes **no rate-card
  argument** — it imports the one card. Because `BILL_RATES` is **total** over `ProjectRoleType`,
  **"a role type with no bill rate" is unrepresentable**: there is no partial-revenue state and no
  `unpricedRoleCount`. The flip side: **revising `BILL_RATES` re-prices every T&M plan
  retroactively**, since revenue is always computed from the current card.
- **Hours = `countWorkingDays(start, end) × hoursPerDay`** (reusing the PTO module's Mon–Fri math).
  **Never the planner grids' `weekPercent`/`bucketPercent`:** per
  [ADR 0040](../decisions/0040-allocations-planner-granularity.md) a grid column is a **flat nominal
  rate**, not a prorated quantity, so money derived from one would be wrong by whole weeks at month
  granularity. Statutory holidays aren't modelled, so hours are a slight overstatement —
  **symmetrically on revenue and cost.**
- **`countsTowardBudget(status)` = everything except `cancelled`.** `paused` still counts (it's
  expected to resume on the dates it carries). This is **not** the allocations grid's
  `["tentative","confirmed"]` filter, which answers a different question. **PTO is deliberately
  ignored**: a salaried person's cost accrues on leave, so netting leave off hours would move
  revenue without moving cost and swing margin for a non-commercial reason. Leave stays on the
  project's Time-off tab.
- **Cost** is per role: the **assignee's own** compensation restated hourly (`PERSON`), or — for an
  **open** role only — the company-wide average for the matching discipline (`ROLE_AVERAGE`).
  Someone assigned but with no employment row is `UNKNOWN`, **not** averaged (averaging would put a
  stranger's number under a named person), and is excluded from the total rather than deflating it.
  `SPECIALIST` averages all billable disciplines — an approximation the UI labels. Every row carries
  its **`RoleCostBasis`** (`PERSON`/`ROLE_AVERAGE`/`UNKNOWN`/**`HIDDEN`**) so an estimate never
  reads as a fact.
- **`marginPercent` is null whenever revenue is 0** — that guards the divide *and* stops an empty
  plan reporting a triumphant 100%. **Two tone helpers, deliberately at different precisions:**
  `marginTone(percent)` rounds to one decimal, `marginAmountTone(amount)` rounds to **whole
  dollars** — because that's how `aggregateMoneyFormatters` renders an aggregate, so a −$0.30 margin
  displays as "CA$0" and must not come out red. Both colour **losses only**. (They reimplement
  `changeTone` rather than importing it: a lib module mustn't depend on a component directory, and
  "zero is neutral" reads as *no change*, which is not what a 0% margin means.)
- **The FX caveat is stated once per panel, and it names the rates.** Every amount in a
  `ProjectMargin` is already in the display currency; the module tracks **`convertedFrom:
  Currency[]`** — the distinct currencies a rate was *actually applied to*, in canonical `CURRENCY`
  order, collected by an internal `noteConversion(from)` that **no-ops when `from` is already the
  display currency** (so a USD figure shown in USD is never claimed as converted). The UI
  renders that once via `FxRateNote`, beside the currency selector. **There is no mixed-currency
  case any more** — one card, one `BILL_RATE_CURRENCY`; `mixedRateCurrencies` and
  `ProjectMargin.mixedCurrencies` are gone. A plan can still need a rate when its fee, the card and
  someone's compensation aren't all denominated alike.
  **This is deliberately a per-*panel* fact, not a per-value one** — "this figure was converted" is
  only half the information, and per-figure markers become noise as soon as more than one value is
  converted; what a reader needs is the **rate** and how fresh it is
  ([ADR 0053](../decisions/0053-project-budgets-and-margin.md) §8). There is **no per-value
  provenance type** — `fx.ts` is just `AED_PER_USD` + `FALLBACK_USD_RATES` + `convert()`; don't
  reintroduce one. Rates come from the existing
  `getExchangeRates()` ([ADR 0029](../decisions/0029-external-fx-rates-and-currency-normalization.md)),
  now called inside **both** plan readers. `resolveDisplayCurrency({ budgetCurrency })` takes a
  fixed fee's own denomination, else the card's currency, else **USD** — not a blanket CAD like the
  compensation dashboards, which would put a conversion note on every T&M project whose figures
  needed no conversion at all.
- **It's a *plan* margin, not an actual** — it costs the allocation, not the logged time.
  `time_entries` are untouched; forecast-vs-actual reconciliation is still unbuilt.

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
`getProjectPlan(id)` + `getProjectPto(id)` + **`getCurrentUser()`** (its `generateMetadata` also
calls `getProjectPlan` to title the tab), `notFound()`s when the plan is null (unknown id), and
renders the client `ProjectDetailView` (`src/components/projects/detail/project-detail-view.tsx`)
with **`canEdit = userHasPermission(user, { projects: ["edit"] })`**.

**This page is the delivery-side editor of the engagement** — not read-only ([ADR
0045](../decisions/0045-project-page-as-delivery-side-role-editor.md)). `canEdit` drives the
**affordances only**; every mutation carries its own `projects.edit` gate in the action metadata.
**Cross-links into this route are wired
across the app**: the `/projects` list **cards** (`project-card.tsx`, a plain `next/link`
wrapping the whole card — the one project cross-link that isn't `InternalLink`), and — all via
the canonical `InternalLink` (`src/components/internal-link.tsx`) — the staff/own-profile
Projects section (`StaffProjectsSection`), the CRM company detail Projects & Referred-projects lists
(`company-detail-view.tsx`) and contact detail Referred-projects list (`contact-detail-view.tsx`),
the opportunity Project-plan tab heading (`opportunity-project-plan.tsx`), and the allocations grid
project cells (`allocations-grid.tsx`, opening in a new tab). The only project references still
left as plain text by design are the **editable timesheet week grid** row labels.

- **Sidebar — three fields editable in place, one deliberately not.** All three are gated on
  `canEdit` and write through `updateProjectField`:
  - **Name** — `project-name-field.tsx`, rendered as the sidebar `<h2>` with a pencil, *not* an
    `InlineEditField` (which would demote the heading to a label/value pair).
  - **Company** — `project-company-field.tsx`: an `InlineEditField` reading as a link to
    `/companies/[id]`, swapping to an `EntityCombobox` over the **`projects.edit`-gated**
    `searchCompanies`, so a delivery manager can **re-parent a project without CRM write access**.
    A company is **required** (`projects.companyId` is `notNull`), so confirming with an empty
    picker reports the requirement client-side instead of writing/unassigning. The server's refusal
    when a linked opportunity belongs to another company surfaces as the field's inline error, so
    the field stays open with an actionable message (see the `updateProjectField` bullet above).
  - **Delivery managers** — `delivery-managers-field.tsx`: an `InlineEditField` +
    `EntityMultiCombobox` over `searchStaff`, each manager linking to `/staff/[id]`.
  - **Line of business stays read-only** because it is *derived from the roles*, not a field; it
    renders as plain comma-separated text rather than `Badge` chips.
  - **`use-project-inline-save.ts`** is the sibling of the opportunity drawer's `useInlineSave`,
    with one deliberate difference: it takes **no `refresh` callback**. The drawer fetches its own
    data client-side, whereas this page is a **Server Component passing `plan` down as a prop** —
    so `revalidatePath("/projects/[id]")` inside `updateProjectField` is what refreshes the
    rendered values (the same mechanism as the CRM company/contact inline fields). Each field owns
    its own hook instance, so pending/error state is isolated; `commit` client-side `safeParse`s
    the field's own slice before the round-trip.
- **Header + summary tiles + budget panel** — project name (editable, above) + derived
  `ProjectStatusBadge`, the editable company field, derived LoB text, then the **same summary
  `StatCard` tiles** as the opportunity Project-plan tab (Length, Dates, Confirmed span, Tentative
  span, Delivery managers) — now the shared `PlanSummaryTiles` component over `plan-summary.ts`, so
  the two surfaces can't drift — and, **above the tabs, the shared `BudgetSummaryPanel`** (revenue /
  cost / margin + the currency toggle + Set/Edit budget). Its per-role counterpart is the
  Timeline grid's `margins` prop. See [Budget & margin](#budget--margin).
- **Three tabs. Roles are editable from *two* of them** — the Timeline Gantt and the Roles table
  both open the same `ProjectRoleDialog`, so there is no "read-only view + edit view" split here:
  - **Timeline — an *editable* reuse of the opportunity planner's `PlannerGrid`**
    (`opportunity-plan/planner-grid.tsx`) fed by the pure `buildWeekColumns`/`buildPlannerRows` with
    **`{ scope: "project" }`** (every row editable, nothing emphasised — see the
    `project-planner-grid.ts` bullet above; the old `currentOpportunityId = ""` sentinel is gone).
    It passes `onEditRole` **only when `canEdit`**, and deliberately passes **neither `onAssignStaff`
    nor the selection/bulk props**: that inline staff picker (`assignRoleStaff`) and the bulk
    delete/duplicate/bump actions are **opportunity-scoped** (`assertRoleEditable`), so wiring them
    here would put deal-side semantics on a delivery-side page. Open roles are staffed through the
    role dialog's staff picker instead. **"Add role" lives in the Roles tab header only.**
    It uses a **project-specific legend** (Confirmed / Tentative / Other project) instead of the
    opportunity planner's "This deal" legend — which is exactly why the emphasis fill must key off
    `emphasized` and not `editable`.
  - **Roles — the same editor as a table.** All roles as a table (staffed first, then
    open/unstaffed placeholders shown as "Open role"), columns Staff · Role · Line of business ·
    Status · Dates · Hrs/day, plus — when `canEdit` — a trailing per-row **pencil** and an **"Add
    role"** button in the section header (the `DetailSection` `action` slot). Both open
    **`project-role-dialog.tsx`** (`ProjectRoleDialog`), keyed per target so the form remounts with
    fresh defaults. Staffed role names link to `/staff/[id]`.
    - It shares the **`RoleFields`** fragment (`src/components/projects/role-fields.tsx`) with the
      planner's `role-dialog.tsx`, extracted so the two editors can't drift — the client-side
      mirror of the server-side shared `projectRoleFields`.
    - Its actions are the project-scoped trio, so unlike the planner's dialog it **can adjust a
      `confirmed` role**. Deleting is therefore behind a **`ConfirmDialog`** (the planner's isn't —
      there only tentative drafts are removable), and when the role carries an `opportunityId` the
      confirmation says removing it **changes that opportunity's plan too**. Both wordings note
      that time already logged against the project is kept (`timeEntries.projectId` hangs off the
      *project*, not the role).
    - **Ripples:** adding/removing a role can shift the project's **derived status** and derived
      lines of business (`deriveProjectStatus` / `deriveProjectLinesOfBusiness`), and every write
      revalidates `/allocations` because project roles are that grid's rows.
  - **Time off** — the project's PTO from `getProjectPto`, split Upcoming / Past. The **Type
    column renders only for `pto.review` reviewers** (driven by `canSeeType`), and **non-reviewers
    see approved leave only** — see the read's permission nuance above.

## Authorization

**Reads are open** — any signed-in user can browse all projects, including the **detail
page** (`getProjectPlan`/`getProjectPto` are server-only; the `(app)` gate is the boundary) — with
**two carve-outs, both masked inside the read rather than hidden in the UI**:

- **Cost & margin need `projects.viewMargin`** (a **new** capability —
  `admin`/`manager`/`finance`/`delivery-manager`; **not `sales`, not `user`**). **Revenue — the
  fixed fee, and the rate card it bills at — is *not* gated**: it's commercial, not personal (and
  the card is a code constant every client bundle already has). Cost is, because a
  role's cost **is an individual's compensation** (their pay ÷ `HOURS_PER_YEAR`), so on a one-role
  project even the aggregate discloses a salary, and the open-role figure is a per-discipline comp
  average — the same bulk exposure `getCompensationSummaryData` gates. It is **deliberately not
  `projects.edit`**: `finance` needs margin without editing projects, and moving a role must not
  imply the right to read someone's salary.
  **`getProjectCostBasis` is the single decision point, and it belongs in the read** — it returns
  `null` before touching `staff_employment`. That's load-bearing because both plan readers ship to
  client components: `getProjectPlan` SSRs into a client component, and `loadOpportunityPlan` is
  gated only on **`crm.edit`**, so `sales` legitimately reaches an opportunity's plan. **Never
  filter cost in the UI, and never widen `loadOpportunityPlan`'s gate to compensate.** See
  [permissions.md](./permissions.md) and
  [ADR 0053](../decisions/0053-project-budgets-and-margin.md).
- **PTO type/pending state needs `pto.review`:** the detail page's Time off tab shows dates + who to
  everyone but masks each leave's **type/pending state** otherwise — and **non-reviewers only get
  approved leave at all** (`getProjectPto` filters pending rows out and nulls those fields in the
  read; it also fails closed with no session — see
  [Project detail page](#project-detail-page)).

**All project writes** are gated by a single flat capability (no
ownership dimension): **`projects.edit`**, granted to `delivery-manager`, `manager`,
`admin`. It covers creating projects and their staffing (`createProject`,
**`createProjectFromOpportunity`**), **re-pricing a project** (**`updateProjectBudget`** — the billing model and, for a fixed fee, the total;
`projects.edit`, *not* `projects.viewMargin`, which only reveals the resulting margin),
**editing a project** (`updateProject` — name + delivery
managers — and the field-scoped **`updateProjectField`** behind the detail page's inline
pencils, which also **moves a project between companies**: re-parenting is a **`projects.edit`**
capability, *not* `crm.edit`, and its picker is the `projects.edit`-gated `searchCompanies` — a
delivery manager re-parents an engagement without any CRM write access), **removing a project from
an opportunity** (`removeProjectFromOpportunity`), **all
planner role CRUD** (`createProjectRole`/`updateProjectRole`/`deleteProjectRole`/`extendProjectRole`),
**the project-page role CRUD**
(`createProjectRoleOnProject`/`updateProjectRoleOnProject`/`deleteProjectRoleOnProject`),
**the bulk role actions + inline staff assignment**
(`deleteProjectRoles`/`duplicateProjectRoles`/`bumpProjectRoles`/`assignRoleStaff`),
**associating an opportunity to an existing project** (`associateOpportunityProject` — a
delivery decision even though it writes an `opportunities` column), and the type-ahead pickers
(`searchStaff`/`searchCompanies`/`searchProjects`). (**Deleting the opportunity itself** —
`deleteOpportunity`, which detaches the project — is a CRM write, gated `crm.edit`; see
[crm.md](./crm.md).) The interactive planner *read*
(`loadOpportunityPlan`) is gated `crm.edit` (it lives in the edit-only drawer); the underlying
`getOpportunityPlan` is server-only. On top of the RBAC gate, **two data-integrity guards** scope
role writes by surface: `assertRoleEditable` restricts *opportunity-scoped* actions to **this
opportunity's own tentative roles**, and `assertProjectRoleEditable` restricts *project-scoped*
actions to **roles on this project** (any status). Neither is access control, and the laxer one is
**not a bypass** — see [ADR 0045](../decisions/0045-project-page-as-delivery-side-role-editor.md).
The detail page's `canEdit` prop is an **affordance flag only**. **The matrix gained one column —
`projects.viewMargin`** — updated in lockstep across `permissions.ts`, `permissions.test.ts` and
[permissions.md](./permissions.md); no *write* gate changed.

## Key flows

- **Price an engagement and watch its margin** (built,
  [ADR 0053](../decisions/0053-project-budgets-and-margin.md)) — a `projects.edit` holder states
  how the work bills **at create time** — a fixed fee (amount + currency), or time & materials,
  which needs **no further input** since it bills at the standard `BILL_RATES` card the dialog shows
  read-only — or re-prices later via the shared budget dialog
  (`updateProjectBudget` — the only route for a project that predates budgets). From then on both
  plan surfaces — the opportunity's Project-plan tab and `/projects/[id]` — show a **Budget & margin
  panel** above the grid and a **per-role margin line inside it**, recomputed from the roles on every
  staffing change. A viewer **without `projects.viewMargin`** sees the same page with revenue only;
  the cost numbers are never sent. See [Budget & margin](#budget--margin).
- **Create a standalone project, then staff it** (built) — creation is minimal: a company,
  a name, and **how it bills** (no LoB/status — those derive). The project starts with **no roles and no delivery
  managers** (so it reads `tentative` with no LoBs). Staffing then happens on **either editor**:
  the **project detail page's Roles tab** (`/projects/[id]` — the natural home for a project with
  no opportunity, since the planner needs a deal to scope to) or the **opportunity planner** (the
  drawer's Project plan tab). Either way a role line is role type + line of business + optional
  staff + optional description + date range + hours/day; leaving staff blank creates a
  **placeholder / open position**. The project's name/company/delivery managers edit via the detail
  page's inline pencils (`updateProjectField`) — the planner's Edit-project dialog
  (`updateProject`) covers name + delivery managers only.
- **Adjust a live engagement's staffing** (built) — from `/projects/[id]`, a `projects.edit`
  holder re-dates a role, moves its hours, swaps its assignee, adds a role, or removes one —
  from **either the Timeline Gantt or the Roles table** (same dialog), and
  **including `confirmed` roles from a won deal**, which the opportunity planner locks. Removing a
  role that carries an `opportunityId` also changes that deal's plan (the confirm dialog warns);
  removing the last live role shifts the project's derived status. Every write revalidates
  `/projects`, `/projects/[id]`, `/opportunities` and `/allocations`. See
  [ADR 0045](../decisions/0045-project-page-as-delivery-side-role-editor.md).
- **Move a project to another client** (built) — from `/projects/[id]`'s sidebar, a `projects.edit`
  holder picks a different company (`updateProjectField`'s `company` variant). The action **refuses**
  while any opportunity linked to this project belongs to a different company, naming it and telling
  the user to unlink or move that deal first — otherwise the same-company invariant
  `associateOpportunityProject` established would break silently. On success it revalidates the
  project's pages **and both companies'** detail pages (each lists the projects it owns). Time
  already logged **follows the project** (`timeEntries.projectId` → project, not company), so the
  consequence is billing attribution, not orphaned hours.
- **Opportunity → Project handoff** (built) — an opportunity gets a project by **creating one
  from it** (`createProjectFromOpportunity`, inheriting name + company, **asking only for the
  budget**) or **associating an existing one** (`associateOpportunityProject`). Entry points: the
  opportunity **detail drawer's** Project-plan empty state and the board's **delivery-stage
  prompt** (the `CreateProjectFromOpportunityDialog` auto-opened when a card is dragged into
  Allocating+ with no project — it **replaced a `ConfirmDialog`** when budgets landed, and reports
  in-flight state so the board can refuse to close mid-submit and lose its pending stage move; see
  the `requiresProject` rule in [crm.md](./crm.md) and
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

- **CRM** — every project belongs to a `companies` row (required FK, `restrict`) — and that
  parent **can be changed** from the project detail page (`updateProjectField`'s `company` variant),
  which is why that write revalidates **both** companies' detail pages and refuses to break the
  same-company invariant with a linked opportunity. The
  opportunity link lives on the **opportunity** side (`opportunities.projectId`, nullable
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
  [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)). **Project roles
  are the `/allocations` grid's rows**, so every project write revalidates that route via
  `revalidateProject` — a role edited from the project page shows up on the planner immediately.
- **Staff compensation (new, and the sensitive one)** — margin joins `projects` →
  `project_roles` → **`staff_employment`**, the projects domain's **first contact with
  compensation** ([ADR 0053](../decisions/0053-project-budgets-and-margin.md)). It reaches it
  through exactly one module (`src/actions/shared/staffHourlyCost.ts`) behind exactly one gate
  (`getProjectCostBasis` / `projects.viewMargin`). A **role's cost is a salary**, so treat anything
  derived from it as compensation data — see [Authorization](#authorization),
  [staff-profiles.md](./staff-profiles.md) and
  [ADR 0020](../decisions/0020-compensation-effective-dated-import-only.md).
- **Timesheets / billing** — projects are what time is logged against (`time_entries.projectId`);
  **billing is still unbuilt**. The margin above is a *plan* figure costed from allocations, **not**
  from logged hours, so forecast-vs-actual reconciliation remains open.

## Open questions / not yet built

- **Project edit is name + company + delivery managers** — no more than that (there is no stored
  status/LoB to edit — both derive from roles), while **roles** have full CRUD via the planner *and*
  the project detail page. ~~The project's company is fixed after create~~ **no longer true:**
  re-parenting landed with `updateProjectField`'s `company` variant. A project
  *can* now be **deleted** (implicitly, via `removeProjectFromOpportunity`/`deleteOpportunity`
  when sole-owned — see [Delete / detach](#delete--detach)), but there is **no standalone
  project-delete action** on `/projects`. The `onDelete: restrict` on `projects.companyId`,
  `opportunities.projectId`, and `project_roles.staffId` still means a company-/staff-delete
  flow must handle live references.
- ~~**Same-company invariant is UI-only**~~ **Resolved** — `associateOpportunityProject`
  enforces project.companyId == opportunity.companyId server-side, `searchProjects` is
  company-scoped, both create paths are same-company by construction, and **re-parenting a project
  refuses rather than breaking it**. See
  [ADR 0019](../decisions/0019-project-opportunity-link.md). Still **not** a DB-level constraint —
  any *future* write that changes either side of the link must re-check it by hand.
- ~~**Roles can only be edited via the opportunity planner**~~ **Resolved** — the project detail
  page is a second, **delivery-side** role editor, reachable from **both its Roles table and its
  Timeline Gantt**
  ([ADR 0045](../decisions/0045-project-page-as-delivery-side-role-editor.md)): any role on the
  project, **any status**, including confirmed roles from a won deal and roles on a standalone
  project with no opportunity. The **planner's** restriction is unchanged and intentional (this
  opportunity's own tentative roles, `assertRoleEditable`). `updateProject`/`updateProjectField`
  still never touch roles. What the project timeline deliberately does *not* get is the
  **opportunity-scoped** interactions — inline staff assignment and the bulk delete/duplicate/bump
  bar, which run `assertRoleEditable`.
- **No role-status control anywhere** — neither editor lets a user set `status` (or
  `opportunityId`): both remain server-controlled provenance. So a confirmed role can be re-dated
  and re-staffed from the project page but never demoted to tentative, paused or cancelled. See the
  `paused`/`cancelled` gap below.
- **`paused`/`cancelled` role states have no UI yet** — the enum values and their derivation
  (into the project's derived status) + badges exist, and the seed exercises them, but **no
  user-facing control sets a role to paused/cancelled**. Added when the planner grows role-state
  controls — no migration needed ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)).
- **Roles are simple rows, not effective-dated history** — a role's dates/hours are
  edited in place, not versioned like `staff_employment`. See
  [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md). Full
  capacity planning (over/under-allocation, conflicts, forecast vs. actuals) is still
  in the Allocations domain's open questions.
- ~~**No budget/value, no rates**~~ **Resolved** — a project carries a billing model (+ a fee when
  fixed), the company bills T&M work at one code-owned per-discipline rate card, and the app computes
  plan revenue/cost/margin
  ([ADR 0053](../decisions/0053-project-budgets-and-margin.md)). What's still missing there:
  **no rate history at all** — revising `BILL_RATES` re-prices every T&M plan retroactively, so a
  past margin can't be reconstructed (dating the card is a deliberate reopening of ADR 0053 §1–2,
  not a field to add); **plan
  margin only** (nothing costs the *logged* hours — forecast-vs-actual is unbuilt); the shipped
  `BILL_RATES` are a **placeholder**; **no per-project pricing** (rejected on purpose — see the ADR
  before proposing it again); and margin per *person* (as opposed to per role and
  per project) doesn't exist.
- **No richer lifecycle/stage model** beyond the derived status.
