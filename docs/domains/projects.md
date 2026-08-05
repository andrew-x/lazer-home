# Domain: Projects

**Status: growing.** Projects data, reads, create/edit/delete flows, the `/projects` list page,
and a **per-project detail page** (`/projects/[id]`, the first single-project route) that is now
the **delivery-side editor of an engagement** (see [Project detail page](#project-detail-page)
below) all exist. This is the **hub linking CRM to delivery** and the first concrete cut of the
proposed **Allocation** concept (`project_roles`). A project also carries an optional link to its
**public Slack delivery channel** (`l-project-<slug>`), created or linked from that detail page — see
[Slack channel](#slack-channel) and [slack.md](./slack.md) — and, since
[ADR 0071](../decisions/0071-google-drive-folder-links-per-user-oauth-and-the-privacy-invariant.md), an
optional **Google Drive folder** (`Lazer Home/Projects/<name>`) plus a **Files** tab that browses it and
adds files to it — see [Drive folder](#drive-folder--the-files-tab) and [drive.md](./drive.md).

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
`staff_employment`. **Margin now also reads on the `/projects` list**, alongside **derived risk
tags** (Negative margin / Low health / No delivery manager / Low margin / Ending soon) whose thresholds live in code — with a
different currency strategy from the plan surfaces
([Margin & flags on the list](#margin--flags-on-the-list),
[ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md)).

**And it now carries a human read on how delivery is actually going** — `project_delivery_notes`,
a **dated write-up carrying its author's 1–10 health rating**, logged on the detail page's
**Delivery notes** tab ([Delivery notes](#delivery-notes),
[ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md)). There is **no
`projects.health` column**: the list's Health figure and its **Low health** tag are derived from
the project's **latest note**, the same "derive it, don't store it" call as status and LoB. Writes
are the existing `projects.edit` capability (**not** author-only — the team that runs an
engagement owns its record) and **reads are open, so unlike margin the health figure and its flag
are shown to every viewer**.

**And it now says who runs it as a *role*, not a field.** The `project_delivery_managers` junction
is **dropped** (`drizzle/0027`): a **delivery manager is a `project_roles` row with
`roleType = "DELIVERY"`** — dated, statused and priced like any other line — so a project's
delivery managers are *derived*, and the plan can now express something the dateless junction
structurally could not: a **delivery-coverage gap**, a stretch of the engagement nobody is running
([Delivery managers & coverage](#delivery-managers--coverage),
[ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)). ⚠️ Because
a `DELIVERY` role is an ordinary role, **its hours and rate now move plan revenue/cost/margin, the
allocations capacity meter, the utilization report's *Planned* series and the home dashboard's
staffing count.** (Unrelated to the RBAC role literally named `delivery-manager`.)

**Otherwise a project stores little of its own** — `id`, `name`, `companyId`, the budget columns,
timestamps (plus the roles relation and its delivery notes). It carries **no stored `status`, no
stored `lineOfBusiness` and no stored delivery manager**: all three are **derived from its roles**,
the first two by the pure module `src/lib/projects/project-derived.ts`
([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md)) and the third by
`src/lib/projects/delivery-coverage.ts` ([ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)).
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
**name + company + budget**; roles — **including the `DELIVERY` role that names who runs it** — are
added afterward in the planner **or on the project detail page**. `updateProject`
(the planner's Edit dialog) is now a **name-only** update; the field-scoped
`updateProjectField` (the detail page's inline pencils) is a **two-variant** union adding
**company** — a project **can** be re-parented to another client, guarded so the move can't strand
a linked opportunity on someone else's client (see the `updateProjectField` bullet under
[What's built](#whats-built)). There is no status/LoB/delivery-manager to edit, all three derive. The **budget is edited by neither** — it has its own action and
its own dialog (`updateProjectBudget` / `ProjectBudgetDialog`), shared by both surfaces, so
renaming a project never re-submits its price. A project can also be **removed**
from an opportunity or **deleted** with the opportunity (see the detach flow below).

## Purpose

Track the billable engagements we deliver for a Company, and who is staffed on them — **one kind of
row, `project_roles`, covering both the people doing the work and the person running it** (a
`DELIVERY` role). Projects are where CRM (a won deal) will flow into delivery, allocations,
timesheets, and billing.

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
    (a T&M project has no total — it bills each role's hours at that role's own
    `billRate`). Mirrored by the zod
    **discriminated union** in `projectBudget.schema.ts`, so a half-written budget is
    *unrepresentable* at both ends. Every pre-existing row satisfies the first branch ⇒ **the
    migration needed no backfill.**
  - **No stored `status`, no stored `lineOfBusiness`, no stored delivery manager.** All three were
    **dropped** and are now **derived from the project's roles**
    ([ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md), the old
    `project_status` pgEnum and `src/lib/project-status.ts` are **deleted**;
    [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md), the
    `project_delivery_managers` junction is **dropped**):
    - **Derived status** — `deriveProjectStatus(roleStatuses)` in `src/lib/projects/project-derived.ts`:
      no roles ⇒ `tentative`; all roles `cancelled` ⇒ `cancelled`; else over the *non-cancelled*
      roles, **least-committed wins** — any `tentative` ⇒ `tentative`, else any `paused` ⇒
      `paused`, else `confirmed`. So a project reads `confirmed` only once **all** its live
      roles are (exactly what `confirmRolesOnWon` produces on a win).
    - **Derived lines of business** — `deriveProjectLinesOfBusiness(roleLobs)`: the distinct
      per-role LoBs in canonical `LINE_OF_BUSINESS` order (a project can span practices now).
    - **Derived delivery managers** — `deliveryManagersOf(roles)` in
      `src/lib/projects/delivery-coverage.ts`: the distinct named people on the project's **live
      `DELIVERY` roles**, name-ordered, each carrying the `spans` they run. **All-time**, not "who
      runs it today" — see [Delivery managers & coverage](#delivery-managers--coverage).
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
- **Project delivery managers** (built, **no table of their own**) — the staff who run a project:
  the named assignees on its live `roleType = "DELIVERY"` roles, *derived* by
  `src/lib/projects/delivery-coverage.ts`. The `project_delivery_managers` junction that used to
  store this was **dropped** in `drizzle/0027_luxuriant_quicksilver.sql` — it carried no dates, so
  it could never say who ran the engagement *in March*, and a project could silently lose delivery
  coverage mid-flight. See [Delivery managers & coverage](#delivery-managers--coverage) and
  [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md). ⚠️ Do not
  confuse this with the RBAC role named `delivery-manager` in `src/lib/auth/permissions.ts` —
  unrelated, and untouched by that change.
- **Project delivery note** (built, [ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md)) —
  a **dated write-up of how an engagement is going**, carrying its author's **1–10 health
  rating**. Table `project_delivery_notes`, id prefix `pdn`
  (`drizzle/0022_bumpy_omega_sentinel.sql`). A **document, not a fact about the project**:
  nothing supersedes anything, and `projects` has **no `health` column** — see
  [Delivery notes](#delivery-notes).
  - `projectId` → projects **cascade** (a note is meaningless without its engagement),
    **`authorStaffId`** → staff **`set null`, nullable** — *attribution only, never an
    authorization input* (which is also why it points at **`staff`**, like
    `projectRoles.staffId`, rather than at `user` as
    `performanceReviewNote.authorUserId` does), **`noteDate`** (`date`, the date the note is
    *about* — `createdAt` is when it was typed), nullable **`title`** (the panel falls back to the
    date), **`body`**, and **`projectHealth`** (`integer`, **notNull**).
  - **`check("project_delivery_notes_health_range")`** — `between 1 and 10`, with the bounds
    interpolated from the scale module via `sql.raw` (a bare `${number}` would emit a bind
    parameter, which a check constraint can't carry), so zod and the DB can't drift. **Not a
    pgEnum:** a numeric rating in one stores strings and needs an `ALTER TYPE` to widen the scale.
  - **Index `(project_id, note_date DESC, created_at DESC)`** — one index serving **both**
    readers in the exact direction each wants (the detail log, and the list's
    `distinct on (project_id)`). **The trailing `.desc()`s are load-bearing:** Postgres walks a
    btree backwards only for a *wholly* reversed ordering, so an ascending index would force a
    sort node.
- **The rate card is still NOT an entity, but a *rate* now is a column.** There is **one
  company-wide rate card, in code** (`src/lib/projects/bill-rates.ts`, keyed **line of business ×
  discipline** — see [The rate card](#whats-built)), and **each `project_roles` row carries its own
  `billRate`, snapshotted from that card when the role is created**
  ([ADR 0066](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)).
  A project still stores **no** pricing: T&M has no total, and there is no per-*project* rate table.
  - ⚠️ **A `project_role_rates` table existed briefly on the branch and was dropped before
    shipping.** It was carried as an honest create-then-drop migration pair, but merging `main`
    renumbered those migrations anyway, so they were regenerated as a single
    `drizzle/0016_violet_whistler.sql` holding only the surviving columns. **No migration
    mentions the table** — [ADR 0053 §1–2](../decisions/0053-project-budgets-and-margin.md) is
    the only record it was tried.
  - A rate card is still **policy**, revised centrally: the card is the only place a discipline's
    price is *decided*, and `project_roles.billRate` is a **snapshot of that decision plus any
    negotiated deviation** — not a competing pricing policy. **A per-*project* rate card is still
    rejected** (two projects silently disagreeing about what an engineer-hour is worth, for no
    product benefit); ADR 0066 reopened the *per-role* half deliberately, as ADR 0053 §1 asked, and
    answered its two objections rather than dismissing them — see it before proposing either shape
    again.
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
  - **`roleType`** (NOT NULL, `projectRoleTypeEnum`: `ENGINEER`/`DESIGNER`/`ARCHITECT`/`QA`/
    `SPECIALIST`/**`DELIVERY`** — six since
    [ADR 0066 §3](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md),
    `drizzle/0024_brainy_dexter_bennett.sql`)
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
  - **`billRate`** (`numeric(12,2)`, number mode, **NOT NULL with no DB default**, under
    `check("project_roles_bill_rate_positive")` — `drizzle/0025_empty_frank_castle.sql`,
    [ADR 0066](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)) —
    what this line bills per hour, in `BILL_RATE_CURRENCY` (**no sibling currency column**: the card
    has exactly one currency, so ADR 0053 §8's FX story is unchanged). **Snapshotted** from
    `billRateFor({lineOfBusiness, roleType})` at creation, then **editable**; revising the card
    prices *future* roles only. This is a **bill** rate (revenue) — a role never carries a cost, which
    is derived from the assignee's compensation and gated on `projects.viewMargin`.
    - **The missing DB default is load-bearing.** A default would put 250 in a second home, ignore
      exception cells, and silently paper over a write path that forgot to snapshot; with none, such
      a path fails loudly. Every insert goes through a role schema, which fills the field via the
      shared **`snapshotBillRate`** transform (below) — don't add a default to "fix" a new insert
      site that skips the schema.
    - **Not effective-dated** ([ADR 0007](../decisions/0007-staff-employment-effective-dating.md)'s
      pattern is deliberately *not* adopted): editing a rate **overwrites** it, so there is still no
      per-role rate *history* and an override is as retroactive as the card used to be.
    - The migration is **hand-edited**: add nullable → `UPDATE … = 250` → `SET NOT NULL` → add the
      check. That literal is a **one-time historical snapshot, not policy** (the card ships with no
      exceptions, so every pre-existing role took the default) — don't revisit it when the card
      moves, which is the whole point of snapshotting.
  - `projectId` → projects **cascade** (a role dies with its project). Indexed on
    `projectId`, `staffId`, **and `opportunityId`**.

  **This is the first concrete cut of the proposed Allocation entity** — see
  [allocations.md](./allocations.md), [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md),
  and [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md).

## What's built

- **Schema** — `src/lib/db/projects-schema.ts` (`projects`, `project_roles`,
  **`project_delivery_notes`** — **three tables**; `project_delivery_managers` was the fourth until
  `drizzle/0027` dropped it, [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)),
  barrelled by `src/lib/db/schema.ts`; imports `opportunities` from
  `./opportunities-schema` (opportunities were split out of `crm-schema.ts` —
  [ADR 0025](../decisions/0025-line-of-business-on-opportunity-and-project-not-role.md)).
  **Schema files are the source of truth for the current shape**; the drizzle history was
  squashed into a single baseline (`drizzle/0000_lethal_rictor.sql`) more than once, with
  **twenty-six** incremental migrations now on top (`0001`–`0026`) — seven of which touch this domain
  (`0002`, `0003`, `0016`, `0022`, `0024`, `0025`, `0026`).
  `drizzle/0002_gray_corsair.sql` applied
  [ADR 0033](../decisions/0033-line-of-business-on-role-derived-project-status.md): it **adds**
  the `paused`/`cancelled` values to `project_role_status`, **adds** `project_roles.line_of_business`
  (backfilled from the parent project, then set NOT NULL), then **drops** `projects.status` +
  `projects.line_of_business` and the `project_status` type. `drizzle/0003_gifted_kylun.sql` then
  **renames** the role's optional label column `project_roles.name` → `description` (a single
  `RENAME COLUMN`; still nullable text, max 200 in the schema). The projects domain now relies on:
  the **six-value** `project_role_type` (`drizzle/0024_brainy_dexter_bennett.sql` is one line —
  `ALTER TYPE … ADD VALUE 'DELIVERY'`) + (four-state) `project_role_status` enums, a nullable
  `project_roles.staff_id` with
  `line_of_business`/`description`/`role_type`/`status`/`opportunity_id`/**`bill_rate`** (NOT NULL,
  no default, `> 0` check — `drizzle/0025_empty_frank_castle.sql`, **hand-edited** into
  add-nullable → backfill 250 → `SET NOT NULL` → add constraint, since Drizzle's bare
  `ADD COLUMN … NOT NULL` can't run against a populated table; same shape as `0002`),
  a `projects` table with **no `status`/`line_of_business` columns** but **three budget
  columns + the `projects_budget_shape` CHECK** and the
  `project_billing_type` enum (`drizzle/0016_violet_whistler.sql`; there is still **no rate-card
  table** — see the bill-rates bullet under
  [Key entities](#key-entities),
  [ADR 0053](../decisions/0053-project-budgets-and-margin.md) and
  [ADR 0066](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)),
  the **`project_delivery_notes`
  table + its health check constraint** (`drizzle/0022_bumpy_omega_sentinel.sql`,
  [ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md)), and the delivery link on
  `opportunities.project_id`. `drizzle/0027_luxuriant_quicksilver.sql` is one line —
  `DROP TABLE "project_delivery_managers" CASCADE`, with **deliberately no backfill** into
  `project_roles` (five NOT NULL columns the junction couldn't supply; an invented `billRate`
  fabricates revenue and an invented `lineOfBusiness` changes the project's *derived* LoB set, so
  the synthetic dev data was re-seeded instead —
  [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)).
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
  bucket server-side instead of fetching every project and deriving in JS. Returns `undefined`
  for all five buckets (no filter — nothing calls it that way since the list became tabs, one
  bucket per read) and a `false` guard for an empty
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
  (**six**: `ENGINEER`/`DESIGNER`/`ARCHITECT`/`QA`/`SPECIALIST`/`DELIVERY`), the `ProjectRoleType`
  type, and `PROJECT_ROLE_TYPE_LABELS`. A **pure, client-importable** module (no `db`/drizzle) so the
  `projectRoleTypeEnum` pgEnum, the create-project zod schema, and the form share one
  source — the same single-source pattern as `line-of-business.ts`. Role type is a role's
  **discipline**, orthogonal to line of business.
  - **`DELIVERY` must stay last in the tuple.** `ALTER TYPE … ADD VALUE` appended it to the pgEnum's
    sort order, so appending it here keeps the tuple and the database agreeing — which matters
    wherever a UI iterates the tuple to render "canonical" order (e.g. `rateCardSummary()`).
    Adding it was **three source lines, one migration and zero UI edits**, because every filter, form
    and label reads the shared tuple + label map — recorded in
    [ADR 0066 §3](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)
    as evidence the [ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)
    convention paid off. **A `DELIVERY` role *is* the delivery manager** — since
    [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md) dropped
    `project_delivery_managers`, this role type is the only way a project names who runs it. (Earlier
    docs said the opposite — "a delivery *role* is not the junction" — which is now exactly
    backwards.) One consequence to keep in mind: because it is an ordinary role, it carries hours
    and a bill rate, so **delivery oversight now shows up in revenue, cost, margin, capacity and
    planned utilization** where it used to be free.
  - It also exports **`STAFF_ROLE_FOR_PROJECT_ROLE_TYPE`** — the `staff_employment.role` each
    project role type corresponds to, used to cost an **open** role from the company-wide average
    for that discipline. **Five map 1:1** (`DELIVERY` included, which closed a latent gap: the staff
    role `DELIVERY` is billable, but with no project role type mapping to it an open delivery role
    could never be costed); **`SPECIALIST` maps to `null`** (the catch-all discipline
    has no staff-role counterpart), so the caller falls back to averaging *every billable*
    discipline. **SPECIALIST's figure did not move** when `DELIVERY` landed — delivery salaries were
    already inside that billable fallback pool; `DELIVERY` simply gained its own bucket. Keep the
    `Role` import **`import type`** — `projects-schema.ts` imports this module
    for **values** (the pgEnum), and `staff-enums` reads its unions out of `staff-schema.ts`, so a
    value import would close a runtime cycle through the schema (same caveat as
    `compensation-targets.ts`).
- **Shared billing-type module** — `src/lib/projects/project-billing.ts` exports `BILLING_TYPES`
  (`FIXED_FEE`/`TIME_AND_MATERIALS`), the `BillingType` type and `BILLING_TYPE_LABELS`. **Pure,
  client-importable**, so the `projectBillingTypeEnum` pgEnum, the zod discriminated union, and the
  dialogs' labels share one source ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)).
- **The rate card (code as policy — the whole of it)** — `src/lib/projects/bill-rates.ts`, reshaped by
  [ADR 0066](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md) and
  now keyed **line of business × discipline**, because what we charge for an hour depends both on the
  practice selling it and the discipline doing it:
  - **`DEFAULT_BILL_RATE`** (`250`) + **`BILL_RATE_EXCEPTIONS`** — a
    `Partial<Record<LineOfBusiness, Partial<Record<ProjectRoleType, number>>>>` listing **only the
    cells that deviate**, which **ships empty**. A total map over both keys would be 5 × 6 = 30
    hand-maintained near-identical cells; an empty map means "one flat rate", and a *fabricated*
    exception would read as a pricing decision nobody made.
  - **`billRateFor({ lineOfBusiness, roleType })`** — **the only sanctioned reader** of the map, and
    the only way to get a rate out of the module. Indexing `BILL_RATE_EXCEPTIONS` yourself puts back
    the `undefined` case the default exists to eliminate. Takes the role **structurally**, so a
    `PlanRole`, a form's watched values or a seed row all pass as-is.
  - **`isOffStandardRate({ lineOfBusiness, roleType, billRate })`** — does this role bill at something
    other than *today's* card? Compares **rounded cents**, not floats: the stored rate has been
    through a `numeric(12,2)` round trip, so a card figure of `333.333` would otherwise make every
    role priced from that cell read as off-card forever. **The card's docstring requires ≤2 decimal
    places** — respect it.
  - **`rateCardSummary()`** (replacing the deleted `standardRateCard()`) — the default plus its
    exceptions in canonical `LINE_OF_BUSINESS` → `PROJECT_ROLE_TYPES` order, *derived* from the map so
    a form can't show a rate the card doesn't hand out; `exceptions.length === 0` is how the UI says
    "one flat rate" in a line.
  - **`BILL_RATE_CURRENCY`** (one currency for the whole card — and therefore for every snapshotted
    rate) and **`BILL_RATES_REVIEWED_ON`** (`2026-08-04`). Read the latter carefully now: it dates the
    card **new roles are created at**, not the card any given plan bills at.
  - ⚠️ **`BILL_RATES` and `isFlatRateCard()` are DELETED, not renamed.** After the reshape the map
    holds *deviations*, not rates, so `BILL_RATES[x]` would have been a lie — deleting it made the
    compiler name all three call sites. Don't reintroduce either.
  - ⚠️ **This module no longer prices existing plans.** Each `project_roles.billRate` is snapshotted
    from it at role creation, so revising a figure prices **future** roles and leaves existing ones
    alone, and **`computeProjectMargin` never imports it** (only `BILL_RATE_CURRENCY`). Putting a
    `billRateFor` lookup back into the margin math is a **bug**, not an optimization — it would
    silently re-price history.
  - **The cost of the `Partial` shape, stated plainly:** totality moved from the type checker to a
    `??`. `billRateFor` still can't return `undefined`, but **adding a `LineOfBusiness` or a
    `ProjectRoleType` no longer breaks the build** — it silently prices at the default (`DELIVERY`
    was the first instance). Only safe because the default is a real price and never a zero; the loop
    over all 30 pairs in `project-margin.test.ts` is what's left of the compile-time pressure.
  - Rates are still **policy**, revised centrally by human judgement, so they live in code (a review,
    not a migration) — the `compensation-targets.ts` /
    [ADR 0042](../decisions/0042-per-role-subratings-app-owned-jsonb.md) precedent. ⚠️ **The shipped
    figure is a flat 250 USD placeholder**, not our real rate card.
- **Shared money primitives** — `src/lib/schemas/money-schema.ts`: **`MAX_MONEY`** (the
  `numeric(12,2)` ceiling, now one home instead of a local const in `projectBudget.schema.ts`) and
  **`optionalMoney({ positive, max })`** — a money field a **blank input means *absent* for**. It
  `preprocess`es `""`/null to `undefined` *before* coercion, because `z.coerce.number()` maps `""` to
  `0` and `.positive()` then **rejects** it, so a plainly-optional amount would error instead of
  coming through absent. It is the **mirror image** of `projectBudget.schema.ts`'s fee, where that
  rejection is load-bearing precisely so a blank fee *fails* rather than saving $0 — same coercion,
  opposite intent, which is why it is a named primitive rather than an inline chain that reads like a
  copy-paste slip. Use it only where absence has a real meaning the caller then supplies.
- **Margin math** — `src/lib/projects/project-margin.ts` (+ `project-margin.test.ts`, **35** tests — a
  sanctioned [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md) exception, same
  grounds as `compensation-plan.test.ts`). **Pure and client-importable**, so the server read and
  the client's currency toggle share one implementation. See
  [Budget & margin](#budget--margin) below for the rules it encodes.
- **Project-health scale** — `src/lib/projects/project-health.ts`
  (+ `project-health.test.ts`, 5 tests). A **pure, client-importable** module
  ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md) shape, mirroring
  `relationship-strength.ts` / `feedback-rating.ts`): `PROJECT_HEALTH_MIN`/`PROJECT_HEALTH_MAX`
  (**1–10**), the `ProjectHealth` type, ten **distinct** labels (Critical · Failing · At risk ·
  Struggling · Mixed · Fair · Steady · Healthy · Strong · Exemplary), `projectHealthLabel(value)`
  and **`PROJECT_HEALTH_UNRATED_LABEL`** (`"Not rated"`). One source for the check constraint's
  bounds, the zod schema, the `StarRating` input, the list's Health column (`PROJECT_HEALTH_MAX` is
  also the `HealthBar`'s segment count) and the detail tile.
  **Ten points, not five:** delivery leads already say "a seven", and a five-point scale collapses
  the interesting middle. **It deliberately does *not* own the low-health threshold** — that is
  policy, and lives in `project-flags.ts`; this module answers "what does a 4 *mean*".
- **Delivery-note limits** — `src/lib/projects/delivery-note.ts`: `DELIVERY_NOTE_TITLE_MAX` (200),
  `DELIVERY_NOTE_BODY_MAX` (20 000), and the shared strings (`DELIVERY_NOTE_HINT`, the title
  placeholder). Pure/client-importable, so the zod schema and the form's inputs share one source.
  Split from the scale module because `project-flags.ts` imports the scale and has no business
  knowing a note's text limits.
- **Delivery-coverage policy (code as policy)** — `src/lib/projects/delivery-coverage.ts`
  (+ `delivery-coverage.test.ts`, **23 tests**, each predicate asserted **by name** so flipping one
  is a visible change — a sanctioned
  [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md) exception on `org-chart`'s
  grounds: this is *policy*, and no type can state that a Friday→Monday handover is contiguous). A
  **pure, client-importable** module (no `db`, no React) that is the single definition of both "who
  runs this project" and "when nobody does", shared by both plan reads, `getProjectsList`, the detail
  sidebar and the coverage warning. Exports `isDeliveryRole` / `isDeliveryCoverage` /
  `needsDeliveryCoverage`, **`deliveryCoverageGaps`**, **`deliveryManagersOf`**, the
  `DeliveryCoverageRole` / `DeliveryCoverageGap` / `DeliveryManagerSummary` types, and
  `DELIVERY_COVERAGE_REVIEWED_ON` (bump it when a predicate changes; deliberately **no threshold
  number** beside it). Full rules and rationale in
  [Delivery managers & coverage](#delivery-managers--coverage) and
  [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md).
- **Risk-flag policy (code as policy again)** — `src/lib/projects/project-flags.ts`
  (+ `project-flags.test.ts`, **33 tests** — another sanctioned
  [ADR 0037](../decisions/0037-unit-tests-removed-except-rbac-matrix.md) exception on ADR 0053's
  margin-math grounds). A **pure, client-importable** module holding the `/projects` list's
  **derived risk tags** and the thresholds that define them: `PROJECT_FLAGS`
  (`negativeMargin` → **`lowHealth`** → **`noDeliveryManager`** → `lowMargin` → `endingSoon`,
  **worst first** — a human saying the engagement is going badly outranks an accountability hole,
  which in turn outranks a thin-but-positive margin), `PROJECT_FLAG_LABELS`,
  `PROJECT_FLAG_VARIANTS` (**only the loss gets colour** — `destructive`; the other four are
  `secondary`, matching `marginAmountTone`'s "colour losses only" rule — `lowHealth` included,
  because a 1–10 score is a human judgement that may be stale where a loss is a computed fact, and
  `noDeliveryManager` because an uncovered period isn't money),
  the `ProjectFlagInputs`
  shape (which takes **pre-derived** `deliveryCoverageGaps`, so this module owns no date arithmetic
  and no part of the coverage policy), and `projectFlags(input)` — a filter over the tuple against a
  `Record<ProjectFlag, predicate>` table. **Exactly the shape of `src/lib/crm/company-status.ts`**
  ([ADR 0034](../decisions/0034-company-status-derived-tags.md)) and `project-derived.ts`, so the
  read that evaluates the flags and the Risk column that renders them share one definition. Config
  constants: `ENDING_SOON_DAYS = 14`, `NEGATIVE_MARGIN_AT_OR_BELOW = 0`,
  `LOW_MARGIN_PERCENT = 0.25`, `LOW_MARGIN_AMOUNT = 10_000`, `MARGIN_FLAG_CURRENCY = "CAD"`,
  **`LOW_PROJECT_HEALTH_AT_OR_BELOW = 4`** (inclusive — the *policy* half of the health scale,
  kept out of `project-health.ts`, which owns the *vocabulary*), plus
  **`PROJECT_FLAGS_REVIEWED_ON`** — bump it when you change a threshold. (`noDeliveryManager`
  added **no** constant, so it did not move it.) Thresholds live in code
  for `bill-rates.ts` / `compensation-targets.ts` reasons: "thin margin" is **policy** the company
  revises centrally, and one shared set means two projects can't disagree about what "healthy"
  means. See [Margin & flags on the list](#margin--flags-on-the-list) for the rules and the
  currency caveat.
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
    `linesOfBusiness[]`, company, **derived** delivery-manager names (the named staff on live
    `DELIVERY` roles, all-time — empty now also covers "there is a delivery role but nobody is in
    it"), role count — **plus a `startDate`/`endDate`
    string range** aggregated from the project's roles, null when role-less, **plus the commercial
    trio added by [ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md):
    `billingType` (null ⇒ "No budget"), `flags: ProjectFlag[]`, and
    `margin: Record<DisplayCurrency, ProjectListMargin> | null`**, **plus `latestHealth` +
    `latestHealthDate`** from the project's most recent delivery note
    ([ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md)) — null ⇒ "Not rated",
    and unlike `margin` it is **not capability-gated**; the date ships because a bare "3/10" reads
    as *now* — see
    [Margin & flags on the list](#margin--flags-on-the-list), **plus `openRoleCount`**
    ([ADR 0061](../decisions/0061-projects-list-as-a-sortable-table.md)): how many of `roleCount`
    have a null `staffId`, tallied from role rows `assembleRows` already fetches so it costs no
    query — and it counts cancelled roles exactly as `roleCount` does, so the Roles cell's two
    numbers always describe the same set),
    **`ProjectsListFilters`** (`{ query?, lineOfBusiness?, deliveryManagerId? }` — a
    case-insensitive substring match on project **or** company name, a single line of business,
    and a single delivery manager: a `staff.id` matched via a **correlated `EXISTS` on
    `project_roles`** using the module-local **`liveDeliveryRole`** condition
    (`roleType = 'DELIVERY' AND status <> 'cancelled'`), which carries a **`LOCKSTEP:`** comment
    naming `isDeliveryCoverage` as its pure mirror — change one, change the other. It omits that
    predicate's `staffId is not null` half because both call sites either compare a specific staff id
    or inner-join `staff`, which drops open roles for free), and three functions over a shared
    `assembleRows` helper
    (`getProjectsInBuckets`, the old unpaginated full-section read, was **deleted** by
    [ADR 0061](../decisions/0061-projects-list-as-a-sortable-table.md) — every tab now takes the
    same paginated path, so the Tentative/Paused/Active buckets are paginated for the first time):
    - **`getProjectsPage(page, buckets, filters?, order?, pageSize?)`** — **the single read behind
      the list**: one page (offset/limit + a `count`, `page` clamped, the `Page<T>` envelope from
      `pagination.ts`), the filter `where` applied to **both** the count and the row query so the
      page count reflects the filtered set. **`order: ProjectsListOrder`** is now
      `{ key, dir }` over the sortable columns (`name` | `client` | `endDate` | `health` |
      `margin`; default `DEFAULT_PROJECTS_ORDER` = name ascending). `endDate` and `health` order by
      **correlated scalar subqueries** — `latestRoleEndDate` (a `max` over role end dates) and the
      new **`latestHealthRating`** — because neither is a column on `projects`; `name` breaks every
      tie so paging stays stable. **Nulls are spelled `nulls last` in *both* directions** (the
      `ordered()` helper branches rather than interpolating the direction, so no part of an
      `order by` is built from a string): Postgres defaults to nulls-*first* under `desc`, which
      would open a descending health sort with every unrated project — and "Not rated" is
      *unknown*, not worst. The `where` also decides the active/past split from **`currentDay()`**,
      read once per call — the one clock read in the loader.
    - **`getProjectsPageByMargin(...)`** (private; `getProjectsPage` delegates when
      `order.key === "margin"`) — **the second execution path.** Margin is computed in
      `assembleRows` from each role's hours and the viewer's cost basis, so it has **no SQL
      expression to order by**: this assembles the whole filtered bucket in name order, sorts it in
      memory with the shared `compareSortValues` (nulls last, same rule), and only *then* slices.
      Paginating first would give a list whose ordering restarts every 20 rows. It sorts on
      **`MARGIN_FLAG_CURRENCY` (CAD)** — the currency the flags are already judged in; the display
      currency is client state that never reaches the server, and one rate set keeps the ranking
      stable either way. **Accepted cost:** the one order that costs more than a page of work,
      opt-in by a header click; revisit past ~500 projects in a bucket.
    - **`getProjectBucketCounts(filters?)`** — the tab counts: `Record<ProjectStatusBucket, number>`
      from **five concurrent `count()`s**, one per bucket, rather than one grouped scan (the bucket
      predicates are correlated-`EXISTS` expressions, not a column to group by). **Filter-aware on
      purpose:** searching "Acme" from the Active tab shows "Cancelled 1" instead of hiding the
      match — that is what stands in for the cross-status flat view the tabs replaced.
    All three **inner**-join companies for `companyName` (required, via the shared `baseColumns`, which
    now also selects the three budget columns); `assembleRows` then resolves
    delivery managers, role statuses/LoBs, role count, the min-start/max-end date range, **the plan
    margin, the latest delivery-note health, the delivery-coverage gaps and the risk flags** in
    **two grouped follow-up queries** scoped to the page's ids — **no N+1** (budgets added none: the
    role query just selects `id`/`roleType`/`hoursPerDay`/`staffId` too; delivery-note health added
    one). **It used to be three:** a grouped `project_delivery_managers → staff` query was
    **deleted** by [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)
    in favour of a `leftJoin(staff)` + `staffName` on the role query already being run — so the
    Delivery column and the `noDeliveryManager` flag are now computed from **one** role set and
    cannot disagree. (Left join, not inner: a null `staffId` is an open role, which must survive so it
    still counts toward the plan window.) The health query is a
    **`selectDistinctOn([projectId])`** ordered by `projectId` then the **shared
    `latestDeliveryNoteFirst`** clause exported by `getProjectDeliveryNotes` — one ordering rule for
    both readers, so the list and the detail log can't disagree about which note is current;
    `distinct on` rather than reducing every note in JS because a weekly note over a two-year
    engagement is ~100 rows. **A third reader of that same ordering rule now exists** — the
    `latestHealthRating` subquery the `health` sort orders by (in `project-status-sql.ts`, where it
    is **spelled out rather than imported**, because `latestDeliveryNoteFirst` lives in the actions
    layer and that module is `lib`). **Keep the three in lockstep**: if they drift, the list sorts
    by one note and displays another.
    **`assembleRows` runs once per render now** (it used to run five times, once per section) —
    **except under `sort=margin`**, which assembles the *whole* bucket rather than a page, so it is
    the multiplier anything added there inherits.
    `status` +
    `linesOfBusiness` are derived in JS via `deriveProjectStatus`/`deriveProjectLinesOfBusiness`;
    the date range exploits `"YYYY-MM-DD"` being zero-padded (lexicographic min/max ==
    chronological). **`currentDay()` is read once for the whole page**, so two rows can't disagree
    about what "soon" means. Its local `listMargin()` helper runs `computeProjectMargin` **once per
    display currency** and keeps only the whole-project totals. Also exports
    **`getDeliveryManagerOptions()`** →
    `DeliveryManagerOption[]` (`{ id, name }`) — the distinct, name-ordered staff who hold a **live
    delivery role** on ≥1 project (the same `liveDeliveryRole` condition, inner-joined to `staff`),
    the option set for the list's delivery-manager filter. **The option set is now derived from live
    plan data and can shrink** when a delivery role is cancelled — deliberate, since the `dm` filter
    excludes cancelled roles too, and an option that matched nothing would read as a broken filter
    rather than an empty result.
  - `getProjectsMarginContext.ts` — **server-only, React `cache()`-wrapped, request-scoped**: the
    shared cost/FX inputs for margin on the *list*, as `{ rates, costBasis, nativeCurrencies }`.
    Deliberately request-scoped rather than per-call: `getRoleTypeAverageCostsUsd` scans all of
    `staff_employment`, so `cache()` memoizes the *promise* and every caller in the request — the
    row read, the five bucket counts, and the page itself — shares one fetch. (It was written for
    the old grouped view, which fired five list reads in parallel; the sharing still earns its keep
    now that the page reads `costBasis` directly.) That scope is also why the cost
    basis covers **every** staff member on any project role rather than the current page's rows — a
    page-scoped id list would be a different cache key per render and defeat the sharing.
    **The page now reads `costBasis !== null` as its one gate for two things** — whether the Margin
    column exists *and* whether `?sort=margin` is honoured. See
    [Margin & flags on the list](#margin--flags-on-the-list).
    **Cost still comes only from `getProjectCostBasis`**, so the `projects.viewMargin` enforcement
    is unchanged and still lives in exactly one place. `nativeCurrencies` is the **list-scoped**
    input to the FX note (see [Margin & flags on the list](#margin--flags-on-the-list)):
    every currency a rate could be applied to *anywhere* in the list — each fixed fee's own
    denomination, `BILL_RATE_CURRENCY` when any project bills T&M, USD when an open role is costed
    from the per-discipline averages, and each assignee's compensation currency.
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
    Returns **`null` when the project id is unknown**, so the page `notFound()`s. It also returns
    **`slack: SlackChannelRef | null`** — the project's Slack delivery channel — as a **sibling
    field, deliberately not part of `PlanProject`**: that type is shared with `getOpportunityPlan`,
    and putting it there would oblige a second read to supply a field the planner grid never
    renders (the same reasoning that keeps delivery notes out of `ProjectDetailPlan`). Both Slack
    columns are already on the `projects` row being read, so it costs no extra query and no join.
    See [Slack channel](#slack-channel). **`drive: DriveFolderRef | null` sits beside it**, on the
    same terms and for the same reasons — see [Drive folder](#drive-folder--the-files-tab).
  - `getProjectPto.ts` — **server-only** read backing the detail page's **Time off** tab.
    Aggregates PTO for **everyone connected to the project** — its staffed role assignees
    (`project_roles.staffId`), **delivery managers included, since they hold `DELIVERY` roles like
    anyone else**. This used to union in a second query over `project_delivery_managers`; it is now
    the **single** `selectDistinct staffId` the read already ran, two queries → one
    ([ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)). Returns
    `{ upcoming, past, canSeeType }` (`endDate >= today` ⇒ upcoming
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
  - **Delivery notes** ([ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md),
    [Delivery notes](#delivery-notes) below):
    - `getProjectDeliveryNotes.ts` — **server-only** read backing the detail page's **Delivery
      notes** tab: every note on a project, **newest first**, left-joined to `staff` for the
      author's name (**LEFT**, not inner — `authorStaffId` is nullable, and an inner join would
      silently drop unattributed notes). Takes **no user and applies no mask**: reads are open like
      every other project read. Returns a **bare array**, not a `…View` object with a `canCreate`
      flag — who may write is the static capability the page already computes as `canEdit`
      (contrast `getStaffReviewNotes`, where what a reader may see genuinely varies per row).
      It also exports **`latestDeliveryNoteFirst`** — `desc(noteDate), desc(createdAt)` — reused by
      `getProjectsList`'s `distinct on`, and the direction the table's index is declared in.
    - `deliveryNotes.schema.ts` — **pure/client-importable** zod (the form imports
      `deliveryNoteContentSchema` as its resolver, so a drizzle-derived schema here would pull the
      table into the client bundle — [ADR 0035](../decisions/0035-schema-modules-by-import-boundary.md)).
      **One `deliveryNoteFields` object spread into create and update**, as
      `selfEvaluations.schema.ts`/`reviewNotes.schema.ts` do, so content rules can't drift between
      them; bounds for `projectHealth` come from the scale module that also drives the check
      constraint. **Deliberately absent everywhere:** `authorStaffId` (session-resolved) and
      `projectId` on update (a note can't be moved between engagements).
    - `createProjectDeliveryNote.ts` / `updateProjectDeliveryNote.ts` /
      `deleteProjectDeliveryNote.ts` — **all three gated on the static `permission: { projects:
      ["edit"] }` and nothing else**: no `authorize` hook, no ownership dimension, so **edit and
      delete are NOT author-only** (the team that runs the engagement owns its record — the
      deliberate inverse of self-evaluations, see [Authorization](#authorization)). Create resolves
      the author via the shared **`resolveAuthorStaffId`** (**moved from `src/actions/crm/` to
      `src/actions/shared/`** for this — two CRM importers updated) and maps an FK violation to
      "That project no longer exists" instead of pre-reading. Update never touches `authorStaffId`
      (an editor usually isn't the writer) or `projectId`; update/delete use
      `.returning()` + `assertRowExists` to catch a note deleted mid-edit and to get the project id.
      All three revalidate via `revalidateProject`.
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
    role rows — each role carries its own `lineOfBusiness`,
    is tagged with the `opportunityId` (provenance), created `tentative`, null `staffId` ⇒
    placeholder. **`deliveryManagerIds` and its junction insert were deleted**
    ([ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)): naming
    who runs the project is now just one of `roles` with `roleType: "DELIVERY"`. **The action still
    accepts `roles`, defaulting to empty** — the standalone form sends only name + company, so a
    fresh project starts role-less. Revalidates `/projects` + `/opportunities`.
  - `updateProject.ts` (+ `.schema.ts`) — the edit behind the planner's
    Edit-project dialog, gated `projects.edit`. **Now a name-only update** — one statement, no
    transaction and no `generateId`, because a project's status, LoBs *and* delivery managers all
    derive from its roles. It is **kept rather than deleted** only because its dialog also owns
    "Remove project". **Roles are not touched here.** Revalidates via the shared
    **`revalidateProject`** — it previously hit only `/projects` + `/opportunities`, missing the
    detail route and `/allocations` entirely. Its schema exports the shared **`projectName`**
    rule, reused by `updateProjectField`'s `name` variant so the dialog and the inline field
    can't drift.
  - `updateProjectField.ts` (+ `.schema.ts`) — the **field-scoped** edit behind the detail page's
    inline pencils, gated `projects.edit`. A **discriminated union on `field`** — **`name` |
    `company`**, two variants since
    [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md) deleted the
    `deliveryManagers` variant — mirroring `updateCompanyField`: each variant writes **only its own
    slice**, so a save can't clobber a concurrent edit to the other field. `name` is a
    `.returning()`-guarded update (`assertRowExists`). **Two variants is still the right shape**: the
    two are genuinely different writes — one column vs. a re-parent carrying a data-integrity refusal
    and a two-company revalidation — so collapsing them would put that rule on a rename path.
    **Status, lines of business and delivery managers are deliberately not fields** — all three
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
      field on `updateProject`**, which re-sends everything it holds (name and, until ADR 0068,
      delivery managers): folding the budget in would make a rename re-submit the project's price — the
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
      individual amount ever leaves the server); the **five** 1:1 disciplines (now including
      `DELIVERY`, which previously had no project role type mapping to it and so could never cost an
      open delivery role) average their own staff, while `SPECIALIST` pools every **billable** role
      (`isBillableRole` — leadership/sales/ops salaries are overhead and would drag a delivery cost
      basis) — **and `SPECIALIST`'s figure did not move** when `DELIVERY` landed, since delivery
      salaries were already in that pool; a role type with **no matching staff is absent, never 0**.
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
    `name`, `companyId`, optional `opportunityId`, and
    `roles` (default empty — no `.min(1)`). **No top-level `lineOfBusiness`/`status`, and no
    `deliveryManagerIds`** — a `DELIVERY` role in `roles` is how a delivery manager is named
    ([ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)). The
    per-role shape is the shared **`projectRole.schema.ts`** (`projectRoleFields` +
    `endOnOrAfterStart` + **`snapshotBillRate`**), reused by `createProjectRole`/`updateProjectRole`:
    per role `staffId`
    optional (absent ⇒ placeholder), **required `lineOfBusiness`** (planner defaults it to the
    opportunity's), optional `description`, required `roleType`, required dates/hours (`endDate >=
    startDate`; hours coerced, positive, ≤24), and an **optional `billRate`** (`optionalMoney`).
    **`status`/`opportunityId` on a role are
    server-controlled, not in this input schema.**
    - **`snapshotBillRate` is a `.transform()`, applied to `projectRoleSchema` *and* all four
      composed role schemas** — so `billRate` is a plain `number` in every schema's *output* type and
      the type checker does the remembering. It can't be a `.default()` like `hoursPerDay`: its
      default depends on two **sibling** fields, not a constant. With five insert paths, two update
      paths and no DB default, a single forgotten `?? billRateFor(...)` would have been a 500 — same
      "one rule, every role schema" reasoning as `endOnOrAfterStart`
      ([ADR 0066 §5](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)).
    - **An absent `billRate` means "use today's card"** — which is also how a role stuck on a
      superseded price gets reset. ⚠️ **This only holds because both update schemas are full-object
      writes.** Under a `saveCompensationPlanItem`-style *partial* patch, an absent rate would
      silently re-snapshot a role whose rate the caller simply didn't send. Noted in the transform's
      docstring; re-read it before adding a patch update.
    `updateProject.schema.ts` is a sibling:
    `projectId` + `name` only. `createProjectFromOpportunity.schema.ts`
    is just `{ opportunityId }`.
  - **Role CRUD (planner) — all gated `projects.edit`.** `createProjectRole` (adds a fresh
    tentative role/open position to the opportunity's project), `updateProjectRole` (edits an
    existing role's fields), `deleteProjectRole` (removes one), `extendProjectRole` (inserts a
    **new** tentative segment sharing a source role's `staffId`/`description`/`roleType`/**`billRate`**
    — re-pricing a continuation at today's card would make "extend" a silent renegotiation; each
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
    role type, dates, hours, **and its `billRate`** — as a fresh **tentative, unstaffed open
    position**, deliberately
    dropping the assigned `staffId`), and **`bumpProjectRoles`** (`+ weeks`: shifts each role's
    `startDate` **and** `endDate` by whole weeks via `addWeeks`, preserving duration; `weeks`
    may be negative to pull work earlier). Plus **`assignRoleStaff`** (`{ roleId, opportunityId,
    staffId }`, `staffId` nullable) — the inline "Assign staff…" picker on an editable unstaffed
    row; sets or clears the role's `staffId`.
    - **Which of these touch the rate, and why** ([ADR 0066
      §4](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)):
      **Duplicate and Extend carry it** — a negotiated price *is* part of the shape, and under
      `NOT NULL` the alternative to carrying it is re-snapshotting at today's card, i.e. a silent
      renegotiation. **`assignRoleStaff` and `bumpProjectRoles` leave it alone** (putting a person
      into an overridden open role must not reset its price; a bump is dates only). And
      **`createProjectFromOpportunity` / `loadOpportunityPlan` insert no roles at all** — named here
      because the opportunity→project conversion is the obvious place to suspect a missed snapshot.
    All are `secureActionClient`, gated `projects.edit`,
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
    `project-derived.ts`, and **`deliveryManagers: DeliveryManagerSummary[]`** — now
    `deliveryManagersOf(roles)` over the role rows already in hand, which already carried `staffId`
    **and** `staffName`, so the junction query is **gone and the read is one query lighter**
    ([ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)). It is
    **read-only wherever shown** — nothing prefills an editor from it any more, and the planner's
    "Delivery managers" summary tile is gone) plus **every** role on it (across all opportunities), each carrying
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
      (`billingType` + `budgetAmount`/`budgetCurrency`), **no rate card**: a rate is a property of each
      role, not of the project's billing model, so it rides on **`PlanRole.billRate`** (non-nullable
      here, which is the compiler pressure that stops a plan reader forgetting to select it) and the
      client imports `bill-rates.ts` only to resolve *today's* card for the off-standard-rate marker.
      ⚠️ **`ExternalAllocation` deliberately carries no `billRate`** — another project's role is never
      priced on this planner, and `billRateFor` would happily accept that shape, so nothing but the
      comment stops someone adding one — plus top-level **`costBasis: PlanCostBasis | null`** (null
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
    `roleTypeLabel`, `hoursPerDay`, **`billRate`** + **`offStandardRate`** — the rate and the
    card comparison **precomputed here**, so the label cell doesn't re-resolve the card per row, and
    kept as a *rate*, never an amount (the money line is `RoleMarginLine`'s job) — `status`,
    **`editable`**, **`emphasized`**, `staffId`,
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
    `rangeLabel` (`"Aug 3 – Dec 12"`), and `yearHint` (`"2026"` or `"2026–2027"`). **Extracted out of
    `opportunity-project-plan.tsx`** so the opportunity Project-plan tab and the new project detail
    page render **identical summary stats from one source**. `deliveryManagerLabel` was **deleted**
    with the "Delivery managers" tile
    ([ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)).
    **`rangeOf` is also the window helper behind `delivery-coverage.ts`**, so a coverage gap is
    measured against exactly the span the Dates tile prints.
  - **Auto-confirm on won** — `src/actions/crm/confirmRolesOnWon.ts` (server-only) flips every
    tentative role tagged with an opportunity to `confirmed` on a genuine transition into
    `closed_won`; wired into `updateOpportunityField`/`updateOpportunityPosition`
    inside their transactions. See [ADR 0031](../decisions/0031-opportunity-project-planner-and-role-status.md)
    and [crm.md](./crm.md).
- **UI** — `/projects` (`src/app/(app)/projects/page.tsx`) + `src/components/projects/**` —
  see [../ui.md](../ui.md). The list is a **sortable, paginated table under a status tab strip**
  ([ADR 0061](../decisions/0061-projects-list-as-a-sortable-table.md); `project-card.tsx` and
  `projects-grid.tsx` — and, long before them, a first `projects-table.tsx`/`ProjectRow` — are all
  **deleted**). **`projects-table.tsx` (`ProjectsTable`)** renders nine columns — **Project · Client
  · Risk · Line of business · Delivery · Roles · Dates · Health · Margin** — identity left, the one
  warning column next, the two figures right-aligned and `tabular-nums` at the edge so they stack
  into something comparable. It is a **client component** (the Margin figure follows the currency
  context; the sortable headers `router.replace`). The page is **`max-w-7xl`, not the `max-w-5xl`
  every other list uses** — an accepted cost, because nine columns don't fit the standard shell and
  the whole point is that the figures line up rather than wrap.
  **What ADR 0057 §7 got right survived the layout change:** the **Risk column carries only the
  derived risk flags** (`PROJECT_FLAG_LABELS`/`_VARIANTS`) and is **empty for an unflagged
  project** — status is the tab now and line of business is plain text, because a badge on every
  row distinguishes nothing and reserving the column for exceptions is what keeps a red "Negative
  margin" visible down a page of twenty. Flags are worst-first, so the cell shows `flags[0]` plus a
  muted `+N` (full list in the `title`) to hold rows to a uniform height. **Empty values stay
  words, never a bare em dash** — "No budget" / "No live roles" / "No roles" / "Not rated" /
  "Unassigned" / "No dates". The **Margin column is omitted entirely — header included — without
  `projects.viewMargin`**, leads with the money and trails the percentage (ADR 0053 §5), and keys
  its no-figure wording off the server's own `null` rather than `roleCount`, which is what closed
  the one residual dash ADR 0057 left behind. **Health gained a bar**
  (`health-bar.tsx`): ten **monochrome** segments beside the figure, with the note's date beneath —
  the point is the *column* you can sweep, and it stays uncoloured because
  [ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md) deliberately kept "Low
  health" a neutral badge; losses in Margin remain the only colour on the page.
  `ProjectStatusBadge` (`project-status-badge.tsx`) survives — just not here: it's still on the
  project detail page and the staff profile's Projects section.
  **`projects-status-tabs.tsx`** replaces the five stacked sections (Active by default, then
  Tentative · Paused · Past · Cancelled, in `PROJECT_STATUS_TABS` order — its own order, leading
  with the default, deliberately not the canonical `PROJECT_STATUS_BUCKETS`). They are **links in a
  `<nav>`, not a `Tabs` primitive**, because the bucket decides the server query: every tab is a
  real, shareable URL, and the default tab is a bare `/projects`. **Counts are filter-aware** and
  every bucket always renders, empty ones included. This collapsed the page's biggest source of
  complexity — the `filtering ? FilteredView : GroupedView` branch, the collapsed-disclosure
  sections and **three page params (`projectsPage`/`pastPage`/`cancelledPage`) down to one
  `page`** — at the cost of **losing the flat cross-status search view**, which the tab counts
  stand in for. `projects-list-filters.tsx`
  (`ProjectsListFilters`) is a **URL-backed** filter bar — a debounced project-OR-company search
  (`q`) + a line-of-business `SelectFilter` (`lob`) + a **delivery-manager
  `SearchableSelectFilter` (`dm`, fed `getDeliveryManagerOptions`, validated against the known
  ids, hidden when there are no delivery managers)** — **unchanged by ADR 0068: the `dm` param,
  `parseDeliveryManager` and this component are exactly as they were; only what the option set and
  the match *mean* moved (live `DELIVERY` roles rather than junction rows)** — the shared **searchable single-select**
  (`src/components/form/filters.tsx`) for long option sets like staff — the same
  `buildListHref`/`PaginationControls` pattern as the
  opportunities/companies/contacts lists, with the search box + its debounce-to-URL effect coming
  from the shared `useUrlSearchFilter`/`SearchFilter` (`src/components/form/search-filter.tsx`; see
  [../ui.md](../ui.md#list-filter-bars)). **"Clear filters" clears the filters only** — it nulls
  `q`/`lob`/`dm` and **keeps the tab and the sort**, because the tab you are on is not something you
  filtered by. **The list's CAD/USD display currency is *not* a URL
  filter** — `projects-currency.tsx` holds it in React context (`ProjectsCurrencyProvider` wrapping
  the filter bar **and** the table, `useProjectsCurrency()` read by the Margin cell) with the
  `ToggleGroup` + `FxRateNote` pushed right in the filter row (`ProjectsCurrencyToggle`). Context
  because the control and the figures it governs are separately rendered;
  client state because currency is a *display* preference, not a filter — putting it in the URL
  would conflate the two and make flipping it a navigation, when both currencies are already in the
  payload. It **defaults to CAD** (a list is for comparing; a column in five denominations can't
  be), deliberately unlike the detail page's per-project `resolveDisplayCurrency`, and the toggle
  **renders only when a cost basis came back** — cosmetic only, since the read is what withholds the
  figures ([ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md) §8).
  **Sorting is server-side and URL-backed** (`sort` + `dir`, vocabulary in
  `src/lib/projects/projects-list-sort.ts`): the list is paginated, so a client-side sort would
  reorder twenty rows while claiming to have ordered the list — which is why the headers are
  `SortHeaderButton`s that navigate rather than `DataTable`/TanStack. **Nulls sort last in both
  directions**, and each column has its own **first-click direction** (names A–Z, dates
  latest-first, **health and margin worst-first** — sorting by those *is* triage).
  `add-project-dialog.tsx` (a **deliberately minimal**
  standalone create form collecting **name + company + budget** — no LoB/status picker, no
  delivery-manager field (there is no such input any more), no roles repeater. Roles default to none
  server-side; status/LoB/delivery managers are all derived once roles exist. Its copy says roles —
  "including a delivery role" — are added afterward in the planner).
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
  `project-name-field.tsx`, **`project-company-field.tsx`**, `use-project-inline-save.ts` and
  `project-role-dialog.tsx`, plus two **read-only** pieces —
  **`delivery-managers-meta.tsx`** (the derived sidebar field that replaced the deleted
  `delivery-managers-field.tsx`) and **`delivery-coverage-notice.tsx`**. See
  [Project detail page](#project-detail-page) below and
  [../ui.md](../ui.md).
- **Shared role form fields** — `src/components/projects/role-fields.tsx` exports `RoleFields`
  (line of business, role type, description, staff picker, dates, hours, **bill rate**),
  `RoleFormValues`,
  `ROLE_ISSUE_FIELDS` and `roleDefaultValues(existing, defaultLineOfBusiness)`. **Extracted out of
  `opportunity-plan/role-dialog.tsx`** so the planner dialog and the project page's
  `ProjectRoleDialog` can't drift — the client-side mirror of the server-side shared
  `projectRoleFields`. **`status` is deliberately absent** (system-driven, never a form field).
  - **`BillRateField` uses the current card rate as its *placeholder*, never as a pre-filled value**
    — it `useWatch`es `lineOfBusiness` + `roleType` and quotes `billRateFor` (falling back to the
    plain default before both are picked). That one choice does all the work: an empty field shows
    exactly what the role will bill at, submitting it blank snapshots that figure server-side, so
    **"leave it alone" and "reset a role stuck on a superseded price" are the same gesture** — and no
    dirty-tracking is needed to stop a typed rate being clobbered when the discipline changes.
    `roleDefaultValues` therefore opens a **new** role blank and an **existing** one at the rate it
    actually carries (which may be off the current card). The label names the currency
    (`Bill rate (USD/hr)`) because there is no per-role currency column.
- **Budget UI** (`src/components/projects/`, [ADR 0053](../decisions/0053-project-budgets-and-margin.md)):
  - **`budget-fields.tsx`** — the form fragment behind **all three** budget editors (deliberately
    the mirror of `role-fields.tsx`): a billing-type picker plus a fee + currency.
    `BudgetFormValues` is just `{ billingType, budgetAmount, budgetCurrency }`. **Both modes'
    fields exist at all times** so switching billing type doesn't discard typed input;
    `toBudgetInput` drops the fee on the T&M branch, so a phantom total can never reach the server.
    Its issue map is
    keyed by `AllKeys<ProjectBudgetInput>` rather than `keyof` — plain `keyof` on a discriminated
    union yields only the discriminant, which would let the map omit the fee fields.
    - **Both billing models render the read-only `StandardRateCard` panel** (it was T&M-only before
      ADR 0066): under a fixed fee the card still seeds every role's rate, and those rates are what
      the budget panel compares the fee against, so a reader setting a fee needs to see it too.
      Read-only because there is nothing to decide, and *showing* the rates is the point — it's what
      makes a billing model a *priced* choice rather than a blank cheque. Built from
      **`rateCardSummary()`**, so a revision surfaces here without anyone touching the form, and it
      lists **only exceptions** (a full LoB × discipline grid is 30 near-identical rows) — "New roles
      are priced at $250/hr, for every discipline and line of business" when the map is empty.
      Captioned "Company-wide and set in code, not per project — last reviewed
      {`BILL_RATES_REVIEWED_ON`}. Revising it prices new roles; existing roles keep the rate they
      were created at."
  - **`budget-dialog.tsx`** (`ProjectBudgetDialog`) — set/edit a budget, wired to
    `updateProjectBudget`. Its own dialog rather than fields bolted onto the planner's
    Edit-project dialog (that one is name-only now and carries a destructive "Remove
    project" — which is the reason it survived at all), and the detail page has no such dialog at
    all — one shared dialog is the only way
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
    "*N* hrs at role rates" (it said "standard rate card" before rates moved onto the roles). Two
    honesty notices remain: no roles yet, and roles with no comp
    on record (cost partial). The **unpriced-role and mixed-currency notices are gone** with the
    per-project card — one card in one currency, and a NOT NULL rate per role, make both states
    unrepresentable.
    - **A fixed fee's Revenue hint gained a second line — `HourlyValueLine`:** "$X at role rates ·
      $Y discount (Z%)", the plan's `hourlyValue` and the delta between it and the fee. This is the
      only place a fee becomes legible as a commercial *decision* rather than just a number. Three
      deliberate choices, all from
      [ADR 0066 §7](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md):
      **uncoloured** (a discount is a negotiation, not a loss; this codebase colours only losses and
      has no success token, so a premium couldn't be green either — Margin keeps the sole tone on the
      panel); rendered **outside the `margin.includesCost` branch**, so a viewer without
      `projects.viewMargin` sees it (it is revenue-side, and it does *not* inherit the cost-side
      caveats — a plan of entirely open roles has a **complete** hourly value); and **rounded before
      the sign and the word are picked**, so a delta rendering as "CA$0" reads plainly "at role
      rates" instead of a signed zero — the `marginAmountTone` rule. `BudgetFigure`'s `hint` is a
      `ReactNode` now, so a figure can carry more than one line.
  - **`plan-summary-tiles.tsx`** — a pure extraction of the Length/Dates/Confirmed/Tentative tile
    row **both** plan surfaces had duplicated. **The "Delivery managers" tile is gone**
    ([ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)): it only
    ever rendered on the opportunity tab (the detail page already suppressed it via the optional
    `deliveryManagers?` prop, now removed with `deliveryManagerLabel`) and it restated a row visible
    in the planner grid immediately below. `DeliveryCoverageNotice` replaced it with something the
    tiles could never carry — a signal that fires only when the plan has a hole.
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
  wired to `updateProject` (**name only** — no status/LoB/delivery managers, since all three
  derive; roles are edited in the grid below, which is also where a delivery manager is named), and
  **"Remove project"**
  (`removeProjectFromOpportunity`). Below that, summary `StatCard` tiles: **Timeline** (length in
  weeks + derived project status), **Dates** (the overall `plan.timeline` start–end) and **Roles**
  count — plus, **when any role is confirmed**, separate **Confirmed**
  and **Tentative** date-range tiles so the locked-in span reads apart from the proposed one. **No
  coverage notice here** — a pre-sale plan is all-tentative and often deliberately unstaffed, so it
  would fire on nearly every opportunity
  ([ADR 0068 §10](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)).
  - **The grid is now role-centric: one row per role** (was one row per person). It has **two
    sticky lead columns — Role and Staff** — then a cell per week column. A filled `OwnBlock` = the
    role active that week, carrying its % of a 40-hour week; a **Staff** cell shows the assigned
    person's name, an inline `EntityCombobox` **"Assign staff…"** picker on editable unstaffed rows
    (wired to `assignRoleStaff`), or a dash. In each **staffed** row's week cells, the assignee's
    **other-project commitments** (from `getOpportunityPlan`'s `externalAllocations`) are greyed in
    behind the own block (project name + % + tooltip), mirroring the allocations grid's block style —
    surfacing over-allocation while planning.
  - **The label cell's second line appends the rate *only when it's off the card*** —
    `"Engineer · 8h/day · $310/hr"` on the exception, silence on the norm. A rate on every row would
    be noise, and a fourth line would make every planner in the app taller. Driven by
    `PlannerRow.offStandardRate`. The **own-block tooltip** (`OwnBlockCell`) states the rate
    unconditionally, appending "(off standard rate)" when it applies — `RoleMarginLine`'s tooltip is
    unchanged and still carries hours/breakdown/percentage/cost basis, not the rate.
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

The commercial layer, added by [ADR 0053](../decisions/0053-project-budgets-and-margin.md) and
re-shaped on the pricing side by
[ADR 0066](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md) — read
both for the *why* behind each rule below. Math lives in the pure
`src/lib/projects/project-margin.ts`; the schema is in [Key entities](#key-entities).

> **There are now four margin surfaces, and `computeProjectMargin` is the only implementation.**
> The two plan panels and the `/projects` column ([below](#margin--flags-on-the-list)) are
> per-project; the fourth is the **portfolio-wide Finance report** at `/reporting/finance`
> ([finance.md](./finance.md),
> [ADR 0070](../decisions/0070-finance-report-fee-proration-and-server-side-aggregation.md)). That
> report **calls this module twice per project** — once on the roles as stored, once on roles clipped
> to a reporting window with the fee scaled — and **changed nothing in `project-margin.ts`**, which
> is deliberate: a portfolio report computing its own revenue would eventually disagree with the
> project it aggregates. **So a change here moves four surfaces.** Two things it now relies on that
> look incidental: that hours are derived from `startDate`/`endDate` (which is what makes a date clip
> yield in-window hours, revenue *and* cost), and that `budgetAmount` is converted and reported
> as-passed (which is what lets a *scaled* fee prorate without any new code path).

- **Revenue.** A **fixed fee** is the `projects` total, converted once — and it is **project-level
  only**: per-role `revenue` is `null`, because apportioning one price across roles would invent a
  number. A **T&M** role's revenue is `hours × role.billRate` in `BILL_RATE_CURRENCY`, and the
  project's is the sum over its counted roles. **`computeProjectMargin` reads no rate card at all**
  now — only `BILL_RATE_CURRENCY`, for conversion: rates arrive on the rows as
  `MarginRoleInput.billRate`, which is why that type deliberately carries **no `lineOfBusiness`** (the
  card's second key is none of the math's business). ⚠️ **Putting a `billRateFor` lookup back in there
  is a bug**, not an optimization — it would silently re-price historical plans. And **ADR 0057's
  server-side precomputation does not transfer**: its reason is that no individual's
  compensation-derived cost may reach the browser, whereas a bill rate is commercial (ADR 0053 §7's
  asymmetry) and `budget-fields.tsx` has always been a `"use client"` importer of the card.
  - **"A role type with no bill rate" is still unrepresentable** — every role carries a NOT NULL rate,
    so there is no partial-revenue state and no `unpricedRoleCount` — but the **reason changed**:
    enforcement moved from a total map to `billRateFor`'s `??`. See the card bullet under
    [What's built](#whats-built) for what that costs.
  - **Revising the card no longer re-prices anything.** ADR 0053's consequence ("revising `BILL_RATES`
    re-prices every T&M plan retroactively, so a past margin can't be reconstructed") is **reversed**:
    a plan's revenue is reproducible from its own rows, and a price change can't silently move
    historical figures. What's left is that an **edit** to a role's rate is still retroactive for that
    role — a snapshot is overwritten, not effective-dated.
- **A fixed fee has a comparator: `BudgetTotals.hourlyValue`** (+ `hourlyValueDelta` /
  `hourlyValueDeltaPercent`) — what this plan would bill if the same roles were charged by the hour,
  so the fee reads as a **discount or premium** rather than a bare number. Non-null **iff**
  `billingType === "FIXED_FEE"` **and** the fee is set (the percent additionally needs a positive
  denominator, reusing `marginOf`'s zero rule). Null on T&M, where it would be *identical* to
  `revenue` and license a UI printing one number twice beside a tautological zero.
  - **It is built from the roles' own rates, never a live card lookup.** Under snapshots there is no
    "rate card value" for a plan; a card-derived comparator would move under the reader's feet on every
    revision — exactly the retroactive behaviour that was removed — and would make the two billing
    models use *different arithmetic*. As built, the T&M revenue expression and the fixed-fee
    comparator are literally the same expression, which is what lets the panel claim they're
    comparable.
  - **ADR 0053 §5's ban on apportioning stands, unamended:** per-role `revenue` is still `null` on a
    fixed fee, and a per-role *hourly value* is deliberately absent too — it's one `.reduce()` from
    the apportionment §5 refused, and "$40k" on a fixed-fee row reads as that role's revenue. But
    **`RoleMargin.billRate` *is* non-null there** (in the **display** currency, like every other
    figure — not `BILL_RATE_CURRENCY`): a rate can't be summed into a fee the way an amount can. That
    line is what keeps the off-standard-rate marker readable on a fixed-fee project.
  - **A fee *is* now attributable to a period — but still never to a role.**
    [ADR 0070](../decisions/0070-finance-report-fee-proration-and-server-side-aggregation.md) §2
    **refines** this rule rather than relaxing it: the Finance report prorates a fee by the share of
    the plan's billable hours landing inside a window, because **time is a basis every role on the
    plan shares**, whereas splitting a fee across roles asserts that *this* engineer earned *that*
    slice of a single negotiated price. The property that makes it a recognition schedule rather
    than an invented number is that **contiguous windows partition the fee exactly**. Nothing in
    this module implements it — proration arrives as a **scaled `budgetAmount`** — and the boundary
    stays visible on that report: a per-**discipline** blended rate is `null` for fixed-fee-only
    hours, for exactly the reason above.
- **"Off standard rate" is *derived*, and deliberately conflates two causes.**
  `isOffStandardRate(role)` compares the stored rate to today's card. There is **no `rateIsCustom`
  provenance column**, so the marker is true both when someone negotiated a different rate *and* when
  the card has since moved and the role still carries the old price.
  - That conflation **is** the design. Snapshotting makes **stale prices** the new failure mode of the
    whole system, and this is the only instrument that surfaces them: "who typed this" isn't
    actionable, "this bills differently from the current card" is — you clear the field. Hence the
    label is always "off standard rate", **never "overridden"**.
  - It is not the per-value provenance system ADR 0053 §8 built and deleted: it **names its
    reference** in the tooltip, appears **only on the exception** (and the one case where it lights up
    every row *is itself the finding*), and is **derived at render** from two values already on
    screen, so there is nothing to rot. A `rateIsCustom` column would be actively worse — it answers
    the unactionable question, needs bookkeeping at nine write sites where one omission yields a
    *lying* column, and duplicates something derivable.
  - **Deferred, don't build:** to separate stale from deliberate later, the honest instrument is not a
    boolean but `project_roles.createdAt` (already there) against `BILL_RATES_REVIEWED_ON` —
    derivable, no migration, and probabilistic, which is why it isn't decided yet.
  - **It now has a portfolio measure**: the Finance report's `OffStandardExposure` — how many roles,
    how many **hours**, and what **amount at role rates** (rate × hours) sits off today's card.
    Deliberately **not** measured in revenue, or the metric becomes a back door to the per-role fee
    apportionment §5 refuses. It reads ~0% while `DEFAULT_BILL_RATE` is a flat placeholder with no
    exceptions — the card being uniform, not the measure being broken.
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
  case any more** — one card, one `BILL_RATE_CURRENCY` for every snapshotted rate;
  `mixedRateCurrencies` and
  `ProjectMargin.mixedCurrencies` are gone. A plan can still need a rate when its fee, the rates and
  someone's compensation aren't all denominated alike.
  - **A fixed-fee panel now legitimately claims a USD conversion** (it had none before ADR 0066):
    the comparator applies the roles' USD rates, so a fixed-fee plan displayed in CAD adds `"USD"` to
    `convertedFrom` and grows an `FxRateNote`. Correct — a USD-derived figure is on screen — and it
    reversed a shipped test. The conversion is **gated on `billingType != null`** so a no-budget
    project can't claim a conversion it never displayed.
  - ⚠️ **The discount percentage is FX-sensitive.** `resolveDisplayCurrency` opens a CAD fee in CAD, so
    a CAD fee against USD rates means "12% discount" drifts with the exchange rate at **zero commercial
    change**. Both sides are shown in one currency so the figure is internally consistent, but the
    *ratio* is rate-dependent — not fixable inside the one-currency-per-panel rule.
  - **`/projects` risk flags will shift**, since `project-flags.ts` thresholds are unchanged while
    their inputs moved: a project can flip in or out of "Low margin" purely from an off-card rate.
    Separately, the list uses list-scoped `nativeCurrencies` rather than `convertedFrom`, so the FX
    consequence above is **invisible there** and `getProjectsMarginContext.ts` needed no change —
    noted because it looks like it should have.
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
  **The blocker is structural, not effort:** `time_entries.projectId` points at a **project**, never
  at a `project_role`, so a logged hour is never attached to the rate it would bill at and **no hour
  in this system can be priced**. That is why the Finance report has no `Planned | Logged` toggle
  while `/reporting/utilization` does (hours need no rate), and why invoiced/actual revenue needs a
  `time_entries → project_role` link before any of it is buildable
  ([ADR 0070](../decisions/0070-finance-report-fee-proration-and-server-side-aggregation.md) §1).

### Margin & flags on the list

The third margin surface, added by
[ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md) — read it for the *why*,
then [ADR 0061](../decisions/0061-projects-list-as-a-sortable-table.md) for the table it now
renders in and the margin **sort**. The rules above still hold (same `computeProjectMargin`, same
gate); what differs is **how the list converts**, **what it does with the number**, and **that the
number can now order the list**.

- **The list precomputes margin server-side in BOTH display currencies** —
  `ProjectListItem.margin` is a `Record<DisplayCurrency, { margin, marginPercent }> | null` — where
  the *detail* page ships native amounts + the rate table and converts on the client
  ([ADR 0029](../decisions/0029-external-fx-rates-and-currency-normalization.md)). **Two surfaces,
  two strategies, on purpose:** there are only two display currencies, so two figures per row is
  far less payload than every role's hours/type/assignee — and, load-bearing, **no individual's
  compensation-derived hourly cost is ever sent to the browser for the list**, which has no
  per-role table to justify it. `null` still means exactly "this viewer lacks
  `projects.viewMargin`". Don't unify the two paths without re-reading both rationales.
- **A plan with no counted roles reports a null margin**, even with a budget set. Its cost total is
  a true zero only because nobody is staffed, so an unstaffed fixed fee would read as a 100% margin
  and an unstaffed T&M project as exactly 0 — which the flags would then call a **loss**. The table
  says "No roles" (or "No live roles") in words; the detail page says the same thing in a notice.
- **There is now a third caller of this math, and it reads *revenue only*:**
  **`getPlanRevenueByProject`** (`src/actions/projects/`), the aggregate behind the home dashboard's
  funnel value ([ADR 0069](../decisions/0069-home-pipeline-closed-at-and-project-plan-deal-value.md),
  [crm.md](./crm.md#pipeline-on-the-home-dashboard)). **One** `project_roles` query for many
  projects (billing arrives from the caller, which already joined `projects`), then
  `computeProjectMargin` with **`includeCost: false`** and an empty `openRoleCostUsd` — so
  `staff_employment` is never queried, `getProjectCostBasis` is never called, and nothing on that
  path is gated, because no compensation-derived figure exists to gate. It applies
  `countedRoleCount === 0 ⇒ null` **for time and materials only** — an unbuilt T&M plan must not
  report "no work sold", but a **fixed fee is a contracted total that doesn't depend on staffing**,
  so an unstaffed fixed-fee project still reports its fee (the common state of a deal at
  Negotiating). This is where it **parts company with `listMargin`**, whose blanket version of the
  rule is about *margin*: an unstaffed plan has a true-zero **cost**, so a fixed fee there would
  read as a triumphant 100% margin. Revenue has no such problem — **don't "align" the two.** Two
  further standing don'ts: don't reach for
  `getProjectsMarginContext()` to get its FX table (that one also computes a cost basis), and never
  add a `billRateFor` lookup there — rates arrive snapshotted on the rows.
- **Flags are evaluated server-side, always in `MARGIN_FLAG_CURRENCY` (CAD)**, never recomputed on
  the client. The CAD/USD control is a *display* choice; applying the amount floor to the displayed
  figure would make a project gain and lose "Low margin" as the reader toggled — the tag would
  describe the rendering, not the engagement. **Consequence to expect:** in USD a row can read
  "$7,400" and still carry "Low margin" because it is CA$10,100. **The margin *sort* runs in the
  same currency, for the same reason** — the display currency is client state that never reaches
  the server, and both figures come from the same native amounts through one rate set, so the
  ranking holds whichever way the toggle is set.
- **The rules** (`project-flags.ts`, worst first): `negativeMargin` at margin **≤ 0** (zero counts —
  breaking even earns nothing) and it **suppresses** `lowMargin`; **`lowHealth` when the latest
  delivery note's health is ≤ 4** (inclusive — see [Delivery notes](#delivery-notes));
  **`noDeliveryManager` when any delivery-coverage gap ends today or later** (see
  [Delivery managers & coverage](#delivery-managers--coverage) — the *whole* policy lives in
  `delivery-coverage.ts`, and `project-flags.ts` takes the gaps **pre-derived** so it keeps owning no
  date arithmetic. Ranked below `lowHealth` because an uncovered period is a *risk* of trouble where
  a low rating is a report of it, and above the money flags on `lowHealth`'s own logic: an
  accountability hole is what *causes* health to go unrated and margin to drift unnoticed. **Past
  gaps are excluded here but shown on the detail page** — a hole in an engagement that finished last
  year is unfixable history, and flagging it would leave a permanent badge on every Past row);
  `lowMargin` on `marginPercent < 25%`
  **OR** `margin < 10,000` (deliberately OR'd — a big engagement at 15% and a small one clearing
  only $10k are both worth a look, and either floor alone misses one); `endingSoon` when the latest
  role end date is within **14 days** of today and not already past. **A cancelled project gets no
  flags** (nothing left to deliver or bill — including no health flag: its last note describes work
  nobody still has to do), and **unknown/withheld margin, or an unrated project, yields no flag** —
  "we can't tell" is not "it's bad", and the absence of a tag must not leak the figure.
- **Which flags you see depends on your capability — but only the *margin* ones.** Without
  `projects.viewMargin`, margin is null, so **Negative margin** and **Low margin** can never
  appear; such a viewer sees **Ending soon**, **Low health** and **No delivery manager**. **Health
  and coverage are both deliberately ungated** (neither derives from anyone's compensation —
  [ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md) §4,
  [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md) §9), so
  they are what a `sales` or `user` reader gets beyond the dates. Still: don't read an unflagged row
  as "this project is fine".
- **!! The margin *ordering* is gated exactly like the margin *figures*.** A margin-ranked list
  discloses which engagements are most and least profitable, and that ranking is derived from
  individual compensation just as the numbers are — so honouring `?sort=margin` while hiding the
  column would leak precisely what `projects.viewMargin` withholds. The page reads the gate **once**,
  as `marginContext.costBasis !== null` (the `null` `getProjectCostBasis` returns for a viewer
  without the capability, ADR 0053 §7 — one decision, one place), and that single boolean **omits
  the column and its `<th>`, hides the currency toggle, and drops `sort=margin` back to the default
  order**, which makes a hand-typed URL inert. The architecture is safe underneath — with no cost
  basis `assembleRows` builds no `MarginRoleInput`s, every `margin` is `null`, and there is nothing
  to sort by. **Standing instruction: do not "repair" that dead sort by costing roles purely to
  order them.** See [ADR 0061 §5](../decisions/0061-projects-list-as-a-sortable-table.md).
- **The Health column renders a figure + a `HealthBar`, not stars, with the note's date beneath.**
  Ten star icons per row would swamp a column of twenty, and the bar exists so the *column* reads
  as a shape you can sweep (ten discrete monochrome segments — the scale is a ten-point integer,
  not a percentage, and colouring it would reverse ADR 0059's deliberately neutral "Low health"
  tag). The **date is shown beside the figure** on purpose: nothing expires a rating, so a bare
  "3/10" would read as *now* (see [Open questions](#open-questions--not-yet-built) on stale health).
  Unrated projects read **"Not rated"**, not a dash — and sort **last in both directions**, because
  "nobody has assessed this" is unknown, not worst.
- **The list's FX note is list-scoped, not per-project provenance.** `ProjectMargin.convertedFrom`
  (what a budget panel states) records the currencies *one project* converted from; the list ships
  `nativeCurrencies` — everything a rate could apply to anywhere in the list — because its control
  converts every row at once. Threading a per-project, per-currency `convertedFrom` through the
  table would put per-role provenance in the payload to qualify one
  footnote. **Accepted cost:** a filtered view showing one CAD project can still quote a rate for a
  currency only some *other* project is priced in.
- **The last residual em dash is closed.** The card's "No roles" branch used to test `roleCount`
  (**all** roles, cancelled included) while the null margin came from `countedRoleCount` (which
  excludes cancelled), so a budgeted project whose roles were *all* cancelled rendered "—". The
  table's `MarginCell` instead **keys off the server's own `null`** and distinguishes "No roles"
  from **"No live roles"**. Keep it that way: reading the null directly closes any future cause of
  the same gap, and "there is no column here" and "this project has no margin" must stay different
  facts.
- **Perf note:** `roleBillableHours`' working-day count runs **twice per role** (once per
  currency). Every bucket is paginated now, so the exposure is one page — **except under
  `sort=margin`, which assembles the whole bucket**; that is the first thing to look at if a bucket
  gets long. Caching hours per role would break the currency symmetry for no gain at today's scale.

## Delivery managers & coverage

**Who runs an engagement, and when nobody does.** Built by
[ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md) — read it for
the *why*. All of it lives in the pure `src/lib/projects/delivery-coverage.ts`; there is **no
table, no column and no capability**.

⚠️ **Not the RBAC role.** `src/lib/auth/permissions.ts` has a role literally named
`delivery-manager`. It is unrelated to everything here and was untouched.

**A delivery manager is a `project_roles` row with `roleType = "DELIVERY"`.** The
`project_delivery_managers` junction is dropped (`drizzle/0027`). It was a dateless, moneyless set
of staff per project: it could say who ran an engagement, never who ran it *in March*, so a project
could lose delivery coverage mid-flight with nothing to notice. As a role the assignment is dated,
statused and priced like any other line — which is what makes a **coverage gap** expressible at all.

**The five exports, and the policy each encodes:**

- **`isDeliveryRole(role)`** — a live `DELIVERY` role, staffed or not.
- **`isDeliveryCoverage(role)`** — the above **plus a named person**. An **open (unstaffed) delivery
  role is not coverage**: "no period without a delivery manager" read literally, and a warning that
  goes quiet at exactly the moment nobody is accountable is the wrong failure mode. Distinguishing
  the two is the *only* reason `isDeliveryRole` exists — it lets the sidebar say "Open delivery
  role — nobody assigned" instead of the flatly wrong "Unassigned".
- **`needsDeliveryCoverage(role)`** — a live **non**-`DELIVERY` role: the work that needs managing.
- **`deliveryCoverageGaps(roles)`** → `{ startDate, endDate, weekdays }[]`, maximal chronological
  runs of uncovered **weekdays**.
- **`deliveryManagersOf(roles)`** → distinct `{ id, name, spans }`, name-ordered, **all-time**.

**The window excludes delivery roles.** It is `rangeOf(roles.filter(needsDeliveryCoverage))` — the
same `rangeOf` the Dates tile prints, so a gap is measured against exactly the span the UI shows.
That exclusion matters twice: a delivery manager wrapping up a month *past* the last engineer must
not **widen** the window it then trivially covers, and a project of only delivery roles has nothing
to manage, so it reports no gaps rather than a self-covering tautology.

**Live = "not `cancelled`", symmetrically on both sides — and this matches neither sibling rule.**
`tentative`, `confirmed` and `paused` all count, so **a tentative delivery manager covers a
confirmed engineering span** and a paused one covers too.

| Surface | Statuses counted | Question |
|---|---|---|
| [Utilization report](./utilization.md) | `confirmed` only | Whose capacity is *committed* |
| [Allocations capacity meter](./allocations.md) | `confirmed` + `tentative` | Whose capacity is *consumed* |
| **Delivery coverage** | everything but `cancelled` | Does the **plan** account for delivery |

Confirmed-only was rejected because a plan born from an unwon opportunity is all-tentative — it
would read as 100% uncovered at the moment nothing is real yet, i.e. loudest where it is least
actionable. The predicate is also *deliberately not* `countsTowardBudget` (which it agrees with
today): that answers "does this line's money belong in the budget", and sharing one function would
move coverage the day a commercial rule changed.

**Weekends are never gap days.** The day scan `continue`s on weekends, so a Saturday is neither
added to a run **nor allowed to end one** — a delivery role ending Friday and its successor starting
Monday yields **no** gap. Consequently **both gap bounds are always weekdays**, so `formatDateRange`
over a gap always names working days.

**There is no minimum-gap threshold.** One uncovered weekday is reported; the cost is that a role
typed one day short of its successor warns. `weekdays` is carried on every gap so the fix is a
one-line `.filter()` if that ever becomes noise rather than signal. `DELIVERY_COVERAGE_REVIEWED_ON`
stamps when the predicates last moved — deliberately with no threshold *number* beside it.

**The manager list is all-time, not "who runs it today."** The `dm` filter is inherently all-time (a
`dm=` link should still find the engagement you ran last year), it mirrors the derived
"Line of business" field it sits beside, and a current-only list would render empty on every
finished project — reading as missing data rather than as "it's over". The dated reality travels in
`spans` (a tooltip) and in the Roles tab.

**⚠️ Delivery time now counts as money and capacity.** A `DELIVERY` role carries `hoursPerDay` and
`billRate > 0` like any other line, so it flows into plan revenue/cost/margin, the fixed-fee
hourly-value comparator, the [allocations planner's capacity meter](./allocations.md), the
[utilization report's *Planned* series](./utilization.md) and the home dashboard's staffing count and
load %. This is the point — oversight used to be free, which made every margin optimistic — but it
**silently moves figures on existing projects**, so it's the first suspect when a number changes for
no commercial reason. The seed gives delivery roles **1–2 h/day** so a manager on three engagements
doesn't read as 300% allocated.

**Two surfaces, deliberately different horizons:**

- **`/projects/[id]`** — `DeliveryCoverageNotice` (`delivery-coverage-notice.tsx`), an
  `InlineNotice` with `IconAlertTriangle` **above the tabs**, after `BudgetSummaryPanel`, for the
  same reason that panel is there: a coverage gap is a fact about the plan as a whole and the fix is
  reachable from both structural tabs. **`tone="muted"`, not destructive** —
  `PROJECT_FLAG_VARIANTS` reserves colour for a loss, `lowHealth` is neutral there despite being the
  strongest list signal, and the precedent is `budget-summary-panel.tsx`'s incomplete-cost notice
  (a muted warning about the plan's *completeness*). Three copy branches (whole project uncovered /
  one gap / several), listing 3 ranges then "and N more" with the full set in `title`; the
  "Add or extend a Delivery role" instruction is `canEdit`-gated; suppressed on a `cancelled`
  project. **It shows past gaps** — this is the delivery-side editor, where a historical hole is
  either a data fix or a fact worth knowing.
- **`/projects`** — the **`noDeliveryManager`** risk flag (third of five), which fires **only on
  gaps ending today or later**, so the Past tab doesn't fill with permanent badges about unfixable
  history. See [Margin & flags on the list](#margin--flags-on-the-list).

**Deliberately *not* on the opportunity drawer's Project-plan tab.** Pre-sale plans are
all-tentative and often deliberately unstaffed, so it would fire on nearly every opportunity.
Because the notice lives in `project-detail-view.tsx` rather than in the shared components, that tab
simply renders one fewer sibling — **no `surface` prop, no dead branch**. If uncosted pre-sale
oversight ever needs surfacing, its home is a *third* `BudgetSummaryPanel` completeness notice, not
a coverage warning.

**Seed shapes (`scripts/seed/projects.ts`)** pin every state on real data: `full` (spans the window,
no warning), `seam` (a handover whose second role starts the *next weekday* — **no** warning, the
case that proves the weekend rule outside the tests), `gap` (~60% covered, warns) and `open`
(unstaffed, warns, and the only shape exercising the sidebar's "Open delivery role" state). Staffing
lines draw from `STAFFING_ROLE_TYPES = PROJECT_ROLE_TYPES` **minus** `DELIVERY`, so a random draw
can't plant a stray delivery role that silently closes a gap, and the delivery role **reuses one of
the project's own staffing LoBs** (a fresh draw would add a practice the project doesn't sell to its
derived LoB set).

## Delivery notes

The human counterpart to margin: **how the engagement is actually going**, stated by the people
running it. Built by [ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md) —
read it for the *why*, especially the two calls that differ from their nearest precedents (no
stored `health` column; writes not author-only).

- **A note is a dated document, and health is derived from the newest one.** Each
  `project_delivery_notes` row is a `noteDate` + optional `title` + `body` + a **1–10
  `projectHealth`** (entity shape under [Key entities](#key-entities)). Nothing supersedes anything.
  **"How is this project doing" = the latest note**, ordered `desc(noteDate), desc(createdAt)` — the
  author-chosen date decides, `createdAt` breaks a same-day tie — via the single exported
  `latestDeliveryNoteFirst` clause shared by the detail read and the list's `distinct on`. So the
  two surfaces can never disagree about which note is current, and **deleting the newest note is how
  the list's health falls back to the one before it** (the delete confirmation says so).
- **The scale is vocabulary; the threshold is policy.** `project-health.ts` owns 1–10 and its ten
  labels (Critical → Exemplary) plus `"Not rated"`; `project-flags.ts` owns
  `LOW_PROJECT_HEALTH_AT_OR_BELOW = 4`. Two modules because they're revised on different cadences —
  and the note's text limits live in a *third* (`delivery-note.ts`), so `project-flags.ts` can
  import the scale without inheriting them.
- **≤ 4, inclusive, and 4 rather than 5 on purpose.** Five is the midpoint where a lead parks an
  engagement they can't call either way (its label is literally "Mixed"), and a badge on half the
  grid isn't a warning; three would only re-state what's already being escalated in a standup. The
  bottom four labels are each a sentence you'd want on a card.
- **No notes ⇒ "Not rated" and no flag.** Extends ADR 0057's rule: "nobody has assessed this" is a
  different statement from "the assessment came back badly".
- **Reads are open; writes are the static `projects.edit` capability, and edit/delete are NOT
  author-only.** See [Authorization](#authorization). The consequence to hold onto:
  **`authorStaffId` is attribution only and is never an authorization input.**
- **Where it shows.** The detail page's **Delivery notes** tab (the log + inline composer/editor)
  and its **Health** summary tile, and on `/projects` the table's **Health column** (figure +
  `HealthBar` + the note's date, and **a sortable one** — `latestHealthRating`) plus the **Low
  health** badge in the Risk column (see
  [Margin & flags on the list](#margin--flags-on-the-list)). The tab uses
  `StarRating max={10}` with a hover-preview label — a 10-point scale is hard to read without one —
  which is safe there because nothing wraps it in a link.
- **Seed fixtures pin the list's rules** (`seedProjectDeliveryNotes`): a project with **no** notes, one
  **at** the threshold, one **one above** it, and one with **two notes on the same `noteDate`** to
  exercise the `createdAt` tie-break. Their `createdAt`s are set explicitly, because `now()` is
  transaction-scoped in Postgres and a bulk insert would otherwise leave that tie-break undefined.

## Slack channel

A project carries an optional link to its **public Slack delivery channel**, `l-project-<slug>`
(slug from the project name). Stored as `projects.slackChannelId` / `…Name` behind a
both-null-or-both-set CHECK plus the named unique index `projects_slack_channel_idx`
(`drizzle/0026_wide_marten_broadcloak.sql`, no backfill — all-null rows satisfy the check). **The
model, the Slack app setup and the integration's limitations live in [slack.md](./slack.md)**; the
projects-side facts:

- **Managed only here**, from the detail page's sidebar (`SlackChannelField`, under the delivery
  managers). Create-or-link in one dialog, unlink behind a confirm; a linked channel renders as a
  hyperlink out to Slack (there is no in-app join or invite-me action). `canManage` is the page's own
  **`canEdit`** (`projects.edit`).
- **The opportunity drawer deliberately does not reach across to it.** Many opportunities can feed
  one project, so no single deal owns the control — and a sales-only viewer (who holds `crm.edit`
  but not `projects.edit`) would face a permanently disabled button. A project created from an
  opportunity also **does not inherit** that deal's scoping channel: private pursuit channel,
  public delivery channel, different members.
- **Public, unlike the scoping channel** — so the workspace listing is *complete* for this kind, and
  search/suggestion actually work end to end here. (There is no naming-convention filter on the
  picker; public channels were never at issue, since every employee can already browse them in Slack.)
- **No `onChanged` callback is passed.** This page is a Server Component handing `plan` down as a
  prop, and the Slack actions call `revalidateProject`, so the server re-renders — the same
  mechanism as `updateProjectField` (the opportunity drawer, which fetches its own payload, passes
  its `refresh` instead).
- **The gate is an `authorize` hook resolving `projects.edit` from the channel `kind`**, not a static
  `metadata.permission`, because the scoping kind needs the *disjoint* `crm.edit`. **No new
  capability and no matrix change** — see [Authorization](#authorization).

## Drive folder + the Files tab

A project also carries an optional link to its **Google Drive delivery folder** at
`Lazer Home/Projects/<project name>`, stored as `projects.driveFolderId` / `…Name` behind a
both-null-or-both-set CHECK plus the named unique index `projects_drive_folder_idx`
(`drizzle/0029_tense_jocasta.sql`, no backfill). **The model, the setup and the privacy invariant that
shapes it live in [drive.md](./drive.md)** — read that first. The projects-side facts, most of which
are the Slack section above with the names changed:

- **Two surfaces.** `DriveFolderField` in the sidebar (below the Slack row — the sidebar's second
  *external* fact, not an attribute of the project) owns create / link / unlink, with `canManage` =
  the page's own **`canEdit`**. A **"Files" tab** sits between *Delivery notes* and *Time off* and
  holds `DriveFilesPanel` inside a `DetailSection`.
- **The page gained no new read.** `getProjectPlan` returns `drive: DriveFolderRef | null` as a
  **sibling of `project`** (exactly like `slack`, and for the same reason — `PlanProject` is shared
  with `getOpportunityPlan`), both columns already being on the row. `/projects/[id]` additionally
  passes **`driveEnabled = isDriveConfigured()`**, which is an env read, not a Drive round-trip; the
  **Files tab lazy-loads its own contents when opened**, so nobody pays for Drive unless they look.
- **No `onChanged` callback**, same as Slack: this is a Server Component handing `plan` down, and the
  Drive link actions call `revalidateProject`.
- **The gate is the same `authorize` hook shape** (`authorizeDriveFolder` → `projects.edit` from the
  folder `kind`), **no new capability and no matrix change**. But note the asymmetry with Slack:
  **browsing the folder and adding files carry no capability at all** — they run on the viewer's own
  Google token, so Google enforces shared-drive membership. On this page `canEdit` still governs the
  *link* controls and the empty-state copy, not the browsing.
- **A project created from an opportunity does not inherit that deal's sales folder** — many
  opportunities, one project, no unambiguous owner (the same call as the scoping channel).
- **Unlink leaves Drive alone.** The folder and every file in it survive; only our two columns are
  cleared, which is what the confirm copy promises.

## Delete / detach

When a project's link to an opportunity is severed, `detachProjectFromOpportunity` (the shared
server-only helper) decides what to clean up, because a project can be **shared** by several
opportunities:

- **Sole owner** — every role on the project belongs to *this* opportunity **and** no other
  opportunity is linked to it **and** there are no unassigned/standalone roles ⇒ the **whole
  project is deleted** (roles — delivery ones included — and delivery notes cascade). This opportunity's `projectId` is
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
`getProjectPlan(id)` + `getProjectPto(id)` + **`getProjectDeliveryNotes(id)`** +
**`getCurrentUser()`** + **`getCurrentStaffIdentity()`** (its `generateMetadata` also
calls `getProjectPlan` to title the tab), `notFound()`s when the plan is null (unknown id), and
renders the client `ProjectDetailView` (`src/components/projects/detail/project-detail-view.tsx`)
with **`canEdit = userHasPermission(user, { projects: ["edit"] })`**. The fifth read exists only to
default the Slack create dialog's invite list to the viewer; the page also passes
**`slackEnabled = isSlackConfigured()`**, which is **one env var read, not a Slack round-trip** — the
stored channel is already on `plan`, and only the *suggestion* costs a network call, which runs
client-side after paint ([Slack channel](#slack-channel)). **`driveEnabled = isDriveConfigured()`** is
the same deal: also just env vars, because the stored folder rides `plan` and the **Files tab loads its
own contents client-side when opened** ([Drive folder](#drive-folder--the-files-tab)). So the page's
read count is unchanged by the Drive work.

**Delivery notes are a *sibling* read, not part of `ProjectDetailPlan`** — deliberately, for two
reasons: `generateMetadata` calls the plan read too, so anything folded into it is fetched twice per
request just to title the tab, and that type is shared with the opportunity drawer's planner, which
has no notes to show.

**This page is the delivery-side editor of the engagement** — not read-only ([ADR
0045](../decisions/0045-project-page-as-delivery-side-role-editor.md)). `canEdit` drives the
**affordances only**; every mutation carries its own `projects.edit` gate in the action metadata.
**Cross-links into this route are wired
across the app**, all via the canonical `InternalLink` (`src/components/internal-link.tsx`) — the
`/projects` table's Project cell (its Client cell links to `/companies/[id]`; the old card wrapped
a whole `next/link` around itself, and that was the one project cross-link that *wasn't*
`InternalLink` — no longer), the staff/own-profile
Projects section (`StaffProjectsSection`), the CRM company detail Projects & Referred-projects lists
(`company-detail-view.tsx`) and contact detail Referred-projects list (`contact-detail-view.tsx`),
the opportunity Project-plan tab heading (`opportunity-project-plan.tsx`), and the allocations grid
project cells (`allocations-grid.tsx`, opening in a new tab). The only project references still
left as plain text by design are the **editable timesheet week grid** row labels.

- **Sidebar — two fields editable in place, two deliberately not.** (It was three-and-one until
  [ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md) made delivery
  managers derived.) Both editable fields are gated on `canEdit` and write through
  `updateProjectField`:
  - **Name** — `project-name-field.tsx`, rendered as the sidebar `<h2>` with a pencil, *not* an
    `InlineEditField` (which would demote the heading to a label/value pair).
  - **Company** — `project-company-field.tsx`: an `InlineEditField` reading as a link to
    `/companies/[id]`, swapping to an `EntityCombobox` over the **`projects.edit`-gated**
    `searchCompanies`, so a delivery manager can **re-parent a project without CRM write access**.
    A company is **required** (`projects.companyId` is `notNull`), so confirming with an empty
    picker reports the requirement client-side instead of writing/unassigning. The server's refusal
    when a linked opportunity belongs to another company surfaces as the field's inline error, so
    the field stays open with an actionable message (see the `updateProjectField` bullet above).
  - **Line of business stays read-only** because it is *derived from the roles*, not a field; it
    renders as plain comma-separated text rather than `Badge` chips.
  - **Delivery managers is now read-only too**, for exactly the same reason — a `MetaField`
    (`delivery-managers-meta.tsx`) mirroring "Line of business" directly above it, with staff links
    and each name's `spans` in a `title` (`../ui.md`'s dates-as-tooltips rule). The inline-editable
    `delivery-managers-field.tsx` was **deleted**. **Three explicit branches, and none falls through
    to `MetaField`'s em dash** — named managers / `Open delivery role — nobody assigned` (a live
    delivery role with nobody in it, which would contradict the Roles tab if it said "Unassigned") /
    `Unassigned` — because on a field that just lost its pencil a bare dash reads as lost data.
    Naming a delivery manager means adding a `DELIVERY` role in the Roles tab.
  - **A `DeliveryCoverageNotice` sits above the tabs**, after `BudgetSummaryPanel` — see
    [Delivery managers & coverage](#delivery-managers--coverage). Computed client-side in a `useMemo`
    over the roles already on the page (pure and clock-free), so it costs the read no column.
  - **The Slack channel row sits below the delivery managers** — the sidebar's only *external* fact
    (a link out, not an attribute of the project). It writes through the Slack actions, not
    `updateProjectField`. With **no bot token configured** it hides itself **only from viewers who
    lack `projects.edit`** — a `canEdit` holder gets a muted "Slack isn't connected" instead, because
    an invisible feature can't be adopted or debugged by the person who'd connect it. An
    already-stored link renders either way, since the deep link needs no bot. See
    [Slack channel](#slack-channel).
  - **The Drive folder row sits directly below it** — the sidebar's *other* external fact, with the
    identical five-case behaviour (including the muted "Google Drive isn't connected" for a `canEdit`
    holder when the env vars are unset, and an already-stored link rendering regardless). Its
    *contents* live in the **Files** tab, not the rail. See
    [Drive folder](#drive-folder--the-files-tab).
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
  span — there is no Delivery-managers tile any more on either surface) — now the shared
  `PlanSummaryTiles` component over `plan-summary.ts`, so
  the two surfaces can't drift — **plus a `Health` tile** (`IconHeartbeat`: `n/10` with the label and
  the **note's date** as its hint, or "Not rated"), fed from `notes[0]` because that read is already
  ordered latest-first, i.e. by the same rule the list derives its figure from. `health` is an
  **optional** `PlanSummaryTiles` prop, omitted on the opportunity's Project-plan tab, which has no
  notes to read. And, **above the tabs, the shared `BudgetSummaryPanel`** (revenue /
  cost / margin + the currency toggle + Set/Edit budget). Its per-role counterpart is the
  Timeline grid's `margins` prop. See [Budget & margin](#budget--margin). **Then, still above the
  tabs, the `DeliveryCoverageNotice`** — see
  [Delivery managers & coverage](#delivery-managers--coverage).
- **Five tabs** (Timeline · Roles · **Delivery notes** · **Files** · Time off — the two structural views
  first, then the narrative, then the external artefacts, then the ancillary one; **Files** loads its
  own contents on open, see [Drive folder](#drive-folder--the-files-tab)). **Roles are editable from
  *two* of them** — the
  Timeline Gantt and the Roles table
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
    Status · Dates · Hrs/day · **Rate**, plus — when `canEdit` — a trailing per-row **pencil** and an
    **"Add role"** button in the section header (the `DetailSection` `action` slot). Both open
    **`project-role-dialog.tsx`** (`ProjectRoleDialog`), keyed per target so the form remounts with
    fresh defaults. Staffed role names link to `/staff/[id]`.
    - It shares the **`RoleFields`** fragment (`src/components/projects/role-fields.tsx`) with the
      planner's `role-dialog.tsx`, extracted so the two editors can't drift — the client-side
      mirror of the server-side shared `projectRoleFields`.
    - **The Rate column marks an off-card rate by *contrast, not an ornament*** (`BillRateCell`): a
      rate matching the card renders **muted**, one that doesn't renders in **full foreground**. No
      badge (badges mean *status* in this table), no icon, no colour — the roles list would otherwise
      grow a glyph on the common case, exactly the noise [../ui.md](../ui.md) records deleting the
      per-figure FX markers over. **The tooltip is on both states** so the fact is discoverable either
      way, and it *names the card's figure* on the exception. It reads the rate straight off the
      payload rather than out of `margin`, so it **still shows on a project with no budget set** —
      where a negotiated rate is arguably most surprising, and where it is invisible in money
      (the panel says "No budget set"). `formatMoney`'s `minimumFractionDigits: 0` is load-bearing —
      `style: "currency"` would otherwise render a whole-dollar rate as "$250.00".
    - Its actions are the project-scoped trio, so unlike the planner's dialog it **can adjust a
      `confirmed` role**. Deleting is therefore behind a **`ConfirmDialog`** (the planner's isn't —
      there only tentative drafts are removable), and when the role carries an `opportunityId` the
      confirmation says removing it **changes that opportunity's plan too**. Both wordings note
      that time already logged against the project is kept (`timeEntries.projectId` hangs off the
      *project*, not the role).
    - **Ripples:** adding/removing a role can shift the project's **derived status** and derived
      lines of business (`deriveProjectStatus` / `deriveProjectLinesOfBusiness`), and every write
      revalidates `/allocations` because project roles are that grid's rows.
  - **Delivery notes** — `delivery-notes-panel.tsx`: the log newest-first (title, or the date when
    blank; author linked to `/staff/[id]`; an "edited" marker when `updatedAt > createdAt`;
    read-only `StarRating max={10}` + `n/10 · label`), with an **inline** composer and per-note
    editor rather than a dialog, and a `ConfirmDialog` delete whose wording explains that removing
    the newest note moves the list's health back to the one before it. The form is **loosely bound**
    (`useForm` + `useAction`, per the forms rule) because the shape deliberately omits the ids, and
    `projectHealth` starts **unset** when composing so an unrated note fails validation rather than
    defaulting someone into a judgement. `canEdit` gates the affordances only; **an editor need not
    be the author.** See [Delivery notes](#delivery-notes).
  - **Time off** — the project's PTO from `getProjectPto`, split Upcoming / Past. The **Type
    column renders only for `pto.review` reviewers** (driven by `canSeeType`), and **non-reviewers
    see approved leave only** — see the read's permission nuance above.

## Authorization

**Reads are open** — any signed-in user can browse all projects, including the **detail
page** (`getProjectPlan`/`getProjectPto` are server-only; the `(app)` gate is the boundary) — with
**two carve-outs, both masked inside the read rather than hidden in the UI**:

- **Cost & margin need `projects.viewMargin`** (a **new** capability —
  `admin`/`manager`/`finance`/`delivery-manager`; **not `sales`, not `user`**). **Revenue — the
  fixed fee, the rate card, each role's `billRate` and the fixed-fee hourly-value comparator — is
  *not* gated**: it's commercial, not personal (and the card is a code constant every client bundle
  already has). Rate **writes** likewise ride the existing `projects.edit`, so
  [ADR 0066](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)
  changed **nothing** in `permissions.ts`, `permissions.test.ts` or
  [permissions.md](./permissions.md) — stated explicitly so a future `/audit-rbac` reader doesn't
  take the omission for an oversight. One consequence worth knowing rather than discovering:
  **`sales` can already reach an opportunity's plan via `loadOpportunityPlan` (`crm.edit`) and can
  therefore set a rate on its roles** — consistent with revenue being open. Cost is gated because a
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
  - **The `/projects` list obeys the same gate through the same door** —
    `getProjectsMarginContext` calls `getProjectCostBasis`, and a null cost basis means
    `ProjectListItem.margin` is null for every card, no toggle renders, and **no margin-based flag
    can fire** (so a non-holder sees only the two **ungated** tags, "Ending soon" and "Low
    health"). The list additionally sends **no
    per-role cost at all**, only two whole-project figures — see
    [Margin & flags on the list](#margin--flags-on-the-list) and
    [ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md).
  - **The Finance report obeys it through the same door, and is the strictest of the four** — the
    whole page is `notFound()`ed on `FINANCE_REPORT_ACCESS = { projects: ["viewMargin"] }` and
    `getFinanceReport` `requirePermission`s and **throws** rather than masking, because unlike a
    project page there is no useful remainder once cost and margin are withheld. Cost inputs still
    come from `getProjectCostBasis` (one decision point, one redundant check accepted on purpose),
    and **all** aggregation happens server-side because a role's cost ÷ its hours *is* that person's
    hourly pay. **No capability and no matrix row were added** — see
    [finance.md](./finance.md#access-control) and
    [ADR 0070](../decisions/0070-finance-report-fee-proration-and-server-side-aggregation.md) §5–6.
- **PTO type/pending state needs `pto.review`:** the detail page's Time off tab shows dates + who to
  everyone but masks each leave's **type/pending state** otherwise — and **non-reviewers only get
  approved leave at all** (`getProjectPto` filters pending rows out and nulls those fields in the
  read; it also fails closed with no session — see
  [Project detail page](#project-detail-page)).

**Delivery notes add no third carve-out.** `getProjectDeliveryNotes` takes no user and masks
nothing — the notes, their authors and their health ratings are readable by anyone who can see the
project — and the list's `latestHealth`/`latestHealthDate` and **Low health** badge ship to every
viewer. That asymmetry with margin is deliberate: health is a **human delivery judgement**, not a
figure derived from an individual's compensation, which is the only reason margin is withheld
([ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md) §4).

**Delivery coverage adds no carve-out either, and *removed* mutation surface.** `deliveryManagersOf`
and `deliveryCoverageGaps` are pure derivations over roles the reads already disclose, so the derived
manager list, the coverage notice and the `noDeliveryManager` flag reach **every viewer** — same
asymmetry with margin, same reason. And
[ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md) **changed no
gate at all**: it deleted `createProject`'s `deliveryManagerIds`, collapsed `updateProject` to a name
and dropped `updateProjectField`'s `deliveryManagers` variant, all of which were already
`projects.edit`. `permissions.ts`, `permissions.test.ts` and
[permissions.md](./permissions.md) are untouched. ⚠️ The RBAC role named `delivery-manager` (below)
is a different thing entirely and was not touched either.

**All project writes** are gated by a single flat capability (no
ownership dimension): **`projects.edit`**, granted to `delivery-manager`, `manager`,
`admin`. It covers creating projects and their staffing (`createProject`,
**`createProjectFromOpportunity`**), **re-pricing a project** (**`updateProjectBudget`** — the billing model and, for a fixed fee, the total;
`projects.edit`, *not* `projects.viewMargin`, which only reveals the resulting margin),
**editing a project** (`updateProject` — the name only now — and the field-scoped
**`updateProjectField`** behind the detail page's inline
pencils, which also **moves a project between companies**: re-parenting is a **`projects.edit`**
capability, *not* `crm.edit`, and its picker is the `projects.edit`-gated `searchCompanies` — a
delivery manager re-parents an engagement without any CRM write access), **removing a project from
an opportunity** (`removeProjectFromOpportunity`), **all
planner role CRUD** (`createProjectRole`/`updateProjectRole`/`deleteProjectRole`/`extendProjectRole`),
**the project-page role CRUD**
(`createProjectRoleOnProject`/`updateProjectRoleOnProject`/`deleteProjectRoleOnProject`),
**the bulk role actions + inline staff assignment**
(`deleteProjectRoles`/`duplicateProjectRoles`/`bumpProjectRoles`/`assignRoleStaff`),
**delivery-note CRUD**
(`createProjectDeliveryNote`/`updateProjectDeliveryNote`/`deleteProjectDeliveryNote` — **all three
the plain static capability, with edit and delete deliberately *not* author-only**: a delivery note
is the operational record of a shared engagement, so the team that runs it can correct it, exactly
as CRM notes and tasks have no per-entry ownership. This is the deliberate **inverse** of
self-evaluations, which are author-only with no admin override
([ADR 0058](../decisions/0058-self-evaluations-dated-records-with-snapshotted-answers.md) §5) —
there authorship *is* the point. Hence **`authorStaffId` is attribution only and never an
authorization input**, and it points at `staff` rather than `user`; a signed-in user with no staff
row writes an unattributed note. See
[ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md) §3),
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
[permissions.md](./permissions.md); no *write* gate changed. **Delivery notes added no capability at
all** (`permissions.ts`, `permissions.test.ts` and permissions.md's matrix table are untouched):
"may correct an engagement's delivery record" has exactly the audience of "may re-date its roles",
so a `projects.deliveryNotes` row would be a second way to spell `projects.edit`.

**Two families of project write are reached through an `authorize` hook rather than a static
capability — the Slack channel actions and the Drive folder actions** — and both still require
`projects.edit`, no more.
`authorizeSlackChannel` parses the channel `kind` off the raw input and requires the capability of
the record being written: `projects.edit` for the project channel, **`crm.edit`** for an
opportunity's scoping channel. It is a hook precisely because those two are **disjoint** in the
matrix, so no single static `metadata.permission` covers both kinds without over-granting one role.
`SLACK_CHANNEL_TARGETS` is what keeps it honest: the hook and every action body read table, columns
*and* capability from the same entry, so "checked `crm.edit`, wrote a `projects` column" is
unrepresentable. **No capability was added and the matrix is untouched** — don't "tidy" it into a
static permission. See [slack.md](./slack.md) and
[ADR 0067](../decisions/0067-slack-channel-links-bot-token-denormalized-pairs-and-record-scoped-gate.md).

**`authorizeDriveFolder` + `DRIVE_FOLDER_TARGETS` are the same construction, line for line**, for
`createDriveFolder`/`linkDriveFolder`/`unlinkDriveFolder` — again **no capability and no matrix
change**. The one thing that differs, and it's worth knowing before auditing it: Drive's
**`loadDriveFolderContents` / `searchDriveFolders` / `copyDriveFile` / `getDrivePickerToken` carry no
capability at all**, deliberately. They run on the **viewer's own Google token** and `driveList`
hardcodes the shared drive, so Google enforces membership and they can only surface what that person
could already see in Drive's UI; a gate would be theatre. `getDrivePickerToken` takes `z.object({})` and
returns `ctx.user`'s token only — **a `userId` parameter there would be a vulnerability, not a
feature.** See [drive.md](./drive.md) and
[ADR 0071](../decisions/0071-google-drive-folder-links-per-user-oauth-and-the-privacy-invariant.md) §7.

## Key flows

- **Price an engagement and watch its margin** (built,
  [ADR 0053](../decisions/0053-project-budgets-and-margin.md) +
  [ADR 0066](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)) — a
  `projects.edit` holder states
  how the work bills **at create time** — a fixed fee (amount + currency), or time & materials,
  which needs **no further project-level input** since each role is priced individually; either way
  the dialog shows the read-only rate card the roles will be priced from — or re-prices later via the
  shared budget dialog
  (`updateProjectBudget` — the only route for a project that predates budgets). **Each role then
  snapshots its rate from the card**, and the role dialog's Bill-rate field (card rate as
  *placeholder*) is where a negotiated price is typed or a stale one cleared. From then on both
  plan surfaces — the opportunity's Project-plan tab and `/projects/[id]` — show a **Budget & margin
  panel** above the grid and a **per-role margin line inside it**, recomputed from the roles on every
  staffing change; a **fixed fee** additionally reads as a discount/premium against what those roles
  would bill hourly. A viewer **without `projects.viewMargin`** sees the same page with revenue only
  (including the rates and that comparator); the cost numbers are never sent. **The create-project
  dialog can't set a rate** — it collects no roles, so every role born there snapshots the card and a
  nonstandard price is a second step in the planner (the `roles` array in `createProjectSchema`
  carries `billRate` regardless, so a future caller can't silently drop it). See
  [Budget & margin](#budget--margin).
- **Record how an engagement is going** (built,
  [ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md)) — on `/projects/[id]`'s
  **Delivery notes** tab a `projects.edit` holder writes a dated note: what's going on, what's at
  risk, what happens next, plus a **1–10 health rating**. Saving it is immediately visible to
  everyone who can see the project (no draft), updates the page's **Health** tile, and — because the
  list reads the **latest** note — changes the project's `Health` field on `/projects` and may raise
  or clear its **Low health** badge (≤ 4). Anyone with the capability can correct or delete the note
  afterwards, author or not; deleting the newest one falls back to the one before it. A project with
  no notes reads **"Not rated"** and carries no badge. See [Delivery notes](#delivery-notes).
- **Spot the engagements in trouble without opening them** (built,
  [ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md)) — `/projects` shows each
  card's **plan margin**, its latest **health**, and up to four **derived risk tags** (Negative
  margin / Low health / Low margin / Ending soon), so the question the page is opened with ("what
  needs attention?") is answered in the
  grid rather than one project at a time. One CAD/USD toggle in the filter bar re-denominates every
  card instantly (both figures ship precomputed), while the **tags are always judged in CAD** so
  they don't move with the display. `projects.viewMargin` holders get the money; everyone else gets
  the dates — **and, since [ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md),
  the health**: every viewer sees each card's latest delivery-note rating and its **Low health**
  badge. See [Margin & flags on the list](#margin--flags-on-the-list).
- **Create a standalone project, then staff it** (built) — creation is minimal: a company,
  a name, and **how it bills** (no LoB/status/delivery managers — all three derive). The project
  starts with **no roles at all** (so it reads `tentative`, with no LoBs and no delivery manager —
  and, having no roles, **no window and therefore no coverage warning yet**: the notice appears once
  there is staffing work no `DELIVERY` role covers). Staffing then happens on **either editor**:
  the **project detail page's Roles tab** (`/projects/[id]` — the natural home for a project with
  no opportunity, since the planner needs a deal to scope to) or the **opportunity planner** (the
  drawer's Project plan tab). Either way a role line is role type + line of business + optional
  staff + optional description + date range + hours/day; leaving staff blank creates a
  **placeholder / open position** — and a role with `roleType: "DELIVERY"` is how you name who runs
  the engagement. The project's name and company edit via the detail
  page's inline pencils (`updateProjectField`) — the planner's Edit-project dialog
  (`updateProject`) covers the name only.
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
- **Staff** — **one staff reference covers both the people doing the work and the person running
  it**: `project_roles.staffId`, `restrict` and **nullable** (null ⇒ placeholder / open position,
  including an *open delivery role*). The separate cascading delivery-manager FK is gone with the
  junction ([ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)).
  **A delivery note's `authorStaffId` is the second staff reference** — `set null`, attribution only,
  so losing the person keeps the note (and a writer with no staff row leaves it unattributed).
  The **reverse read** (which projects a person is on) lives in the staff domain:
  `getStaffProjects(staffId)` (`src/actions/staff/getStaffProjects.ts`) — now **one query** over
  `project_roles.staffId`, since running a project *is* a role. Its relationship labels come from
  `PROJECT_ROLE_TYPE_LABELS` alone, still delivery-first (compared against
  `PROJECT_ROLE_TYPE_LABELS.DELIVERY`, **sourced not typed**), which is why **the label changed from
  "Delivery manager" to "Delivery"**. One row per project (name, company, **derived** status,
  relationship labels) for the profile's Projects sub-section — the status is computed via
  `deriveProjectStatus` (no stored column). See [staff-profiles.md](./staff-profiles.md).
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
- **Slack** — a project owns its **public delivery channel** (`slackChannelId`/`Name`); the mirror
  pair on `opportunities` is the private scoping channel, and **each record manages only its own**
  (the opportunity drawer never reaches across to this one). Both kinds share one pure module and one
  `authorize` hook, but no capability — see [Slack channel](#slack-channel) and [slack.md](./slack.md).
  This is the projects domain's **second external dependency** after FX, and its first
  secret-bearing one.
- **Google Drive** — a project owns its **delivery folder** (`driveFolderId`/`Name`); the mirror pair on
  `opportunities` is the sales folder, with the same one-record-one-slot rule, the same hook and again
  no capability. The projects domain's **third** external dependency, and the first one whose calls run
  as the **signed-in user** rather than on a shared credential — which is also why it caches nothing.
  See [Drive folder](#drive-folder--the-files-tab) and [drive.md](./drive.md).
- **Timesheets / billing** — projects are what time is logged against (`time_entries.projectId`);
  **billing is still unbuilt**. The margin above is a *plan* figure costed from allocations, **not**
  from logged hours, so forecast-vs-actual reconciliation remains open — and **can't be closed
  without a `time_entries → project_role` link**, since the FK is to the *project*, so no logged
  hour carries a rate.
- **Finance (reporting)** — [finance.md](./finance.md) is the **portfolio view of this domain's
  commercial layer**: `/reporting/finance` aggregates `projects` + `project_roles` over a date
  window through the very same `computeProjectMargin`, behind the very same `projects.viewMargin`
  gate, reusing `marginAmountTone` and `FxRateNote`. It adds **no table, no capability and no matrix
  row** — but it is a *fourth* reader of the margin math, so treat that module as shared
  infrastructure now.

## Open questions / not yet built

- **Project edit is name + company** — no more than that (there is no stored
  status/LoB/delivery-manager to edit — all three derive from roles), while **roles** have full CRUD via the planner *and*
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
- **Nothing *requires* a project to have a delivery manager** — coverage is surfaced, never
  enforced. A NOT NULL-style invariant would block creating a plan before staffing it, which is how
  plans are actually built. Two related deliberate gaps
  ([ADR 0068](../decisions/0068-delivery-managers-as-project-roles-and-coverage-gaps.md)): there is
  **no minimum-gap threshold**, so a role typed one weekday short of its successor warns (the fix is
  a one-line `.filter()` on `gap.weekdays`, which is why that field is carried though nothing reads
  it), and `deliveryManagersOf` is **all-time**, so it does not answer "who do I escalate to today" —
  only each name's `spans` tooltip disambiguates.
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
  fixed), the company prices work from a code-owned card keyed **line of business × discipline** that
  each role **snapshots** into its own `billRate`, and the app computes
  plan revenue/cost/margin
  ([ADR 0053](../decisions/0053-project-budgets-and-margin.md),
  [ADR 0066](../decisions/0066-rate-card-by-line-of-business-and-snapshotted-role-bill-rates.md)).
  ~~revising the card re-prices every T&M plan retroactively~~ **resolved by 0066** — a revision prices
  only future roles and a plan's revenue is reproducible from its own rows. What's still missing there:
  - **No rate *history*.** A snapshot is **overwritten** on edit, not effective-dated
    ([ADR 0007](../decisions/0007-staff-employment-effective-dating.md)'s pattern was deliberately not
    adopted), so an edit is retroactive for that role and a past margin still can't be fully
    reconstructed.
  - **Stale prices are the new failure mode**, and the only instrument for them is the *derived*
    "off standard rate" marker, which can't tell a negotiated rate from a superseded one. Deliberate —
    and the honest next step is `project_roles.createdAt` vs. `BILL_RATES_REVIEWED_ON`, **not** a
    `rateIsCustom` column (see [Budget & margin](#budget--margin)).
  - **The card's exceptions map ships empty and the default is a placeholder**, so nothing yet varies
    by practice; and because the map is `Partial`, **adding a line of business or a discipline no
    longer breaks the build** — it silently prices at the default.
  - **Plan margin only** (nothing costs the *logged* hours — forecast-vs-actual is unbuilt);
    **no per-project pricing** (still rejected on purpose — see ADR 0053 §1–2 and ADR 0066 before
    proposing it again); and margin per *person* (as opposed to per role and
    per project) doesn't exist.
- **The list's risk flags have no history and still can't be filtered on**
  ([ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md)). Revising a threshold
  re-tags every project retroactively and silently — `PROJECT_FLAGS_REVIEWED_ON` is the only signal
  of when the policy last moved. ~~**and no margin sort**~~ **resolved** by
  [ADR 0061](../decisions/0061-projects-list-as-a-sortable-table.md), which answered the nulls
  question it was blocked on (**nulls last in both directions**) and gated the *ordering* on
  `projects.viewMargin` alongside the figures. Still missing: **no "flagged only" filter** — a
  `SelectFilter` over flags would have to be evaluated in SQL rather than in `assembleRows`, and
  sorting health or margin worst-first already answers most of what it would. Additive, no schema.
- **Nine columns is a lot, and margin's sort doesn't paginate in SQL.** If the table reads cramped
  with real data, Line of business and Roles are the first two to fold into the Project cell as a
  muted second line. And `sort=margin` assembles the whole filtered bucket before slicing (it has no
  SQL expression) — bounded by consultancy scale today; revisit past ~500 projects in a bucket.
- **Health can go stale, and nothing says so** ([ADR 0059](../decisions/0059-project-delivery-notes-and-list-health.md)).
  No rating expires, so a **Low health** badge can be driven by a note from a year ago — and, worse,
  a project that was healthy last winter still *reads* healthy today. That's why
  **`latestHealthDate` ships to the list** and both the Health column and the detail tile print the
  date beside the figure. The obvious next step is a **`staleHealth` flag or a recency cutoff on
  `lowHealth`** — deliberately not built, because it needs a policy answer ("how old is too old"),
  which is a threshold decision to make on purpose rather than guess. No schema change either way.
- ~~**Health can't be sorted**~~ **resolved** by
  [ADR 0061](../decisions/0061-projects-list-as-a-sortable-table.md): the latest-note lookup moved
  into the base query as the correlated scalar subquery `latestHealthRating`, so the column sorts
  (unrated last, both directions). **Filtering** on health — a "Not rated" or flagged-only
  filter — is still unbuilt. Additive, no schema.
- **No richer lifecycle/stage model** beyond the derived status.
