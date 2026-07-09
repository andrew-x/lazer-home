# Domain: Projects

**Status: growing (first slice).** Projects data, reads, a create flow, and the
`/projects` page all exist (create + read only — no edit/delete, mirroring
opportunities). This is the **hub linking CRM to delivery** and the first concrete
cut of the proposed **Allocation** concept (`project_roles`). The link *from* a won
Opportunity *to* a Project is still **proposed** — projects are created standalone
today. Built mirroring the Opportunities feature.

## Purpose

Track the billable engagements we deliver for a Company, and who is staffed on them
(delivery managers + role lines). Projects are where CRM (a won deal) will flow into
delivery, allocations, timesheets, and billing.

## Key entities

- **Project** (built) — billable work that **always belongs to a Company**. Fields:
  `name` (required), required `companyId` (FK → `companies`, **`onDelete: restrict`**
  — a company with live projects can't be deleted, exactly like `opportunities`),
  timestamps. Table `projects`, id prefix `proj`. Schema in
  `src/lib/db/projects-schema.ts` (barrelled by `src/lib/db/schema.ts`).
- **Project delivery managers** (built) — the staff who run a project. A **junction
  table** `project_delivery_managers` (many staff per project) following the CRM
  junction convention exactly ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)):
  surrogate `text` PK (`proj-dm`), a `unique(projectId, staffId)` for set-semantics,
  an `index` on `staffId` for reverse lookups, and **both FKs `onDelete: cascade`**.
- **Project role** (built) — a **staffing line**: a person on a line of business for
  a date range at N hours/day. Table `project_roles`, id prefix `proj-role`. **Not a
  pure junction** — it carries columns: `lineOfBusiness` (reuses the shared
  `lineOfBusinessEnum`), `startDate`/`endDate` (`date`, string mode, `"YYYY-MM-DD"`),
  `hoursPerDay` (`numeric(4,2)`, number mode, default `8`, allows half-days). FKs:
  `projectId` → projects **cascade** (a role dies with its project), `staffId` →
  staff **`restrict`** (a role without its person is meaningless; deleting staff with
  live roles is blocked). Indexed on both `projectId` and `staffId`. **This is the
  first concrete cut of the proposed Allocation entity** — see
  [allocations.md](./allocations.md) and [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md).

## What's built

- **Schema** — `src/lib/db/projects-schema.ts` (`projects`, `project_delivery_managers`,
  `project_roles`), barrelled by `src/lib/db/schema.ts`. Migration
  `drizzle/0015_premium_vertigo.sql`.
- **Shared line-of-business module** — `src/lib/line-of-business.ts` exports the
  `LINE_OF_BUSINESS` tuple, the `LineOfBusiness` type, and `LINE_OF_BUSINESS_LABELS`.
  A **pure, client-importable** module (no `db`/drizzle) so the `lineOfBusinessEnum`
  pgEnum in `staff-schema.ts`, the projects zod schema, and the client form all share
  **one source of truth** — the same single-source pattern opportunities uses for its
  `source`/`status` enums ([ADR 0016](../decisions/0016-junction-table-and-shared-enum-conventions.md)).
  Line of business is a **shared/global enum** reused across staff, CRM, and
  projects/allocations.
- **Server layer** — `src/actions/projects/`:
  - `getProjectsPage.ts` — server-only read (per [ADR 0010](../decisions/0010-actions-layer-owns-db-access.md)),
    server-side offset/limit pagination via `src/lib/pagination.ts` (same envelope as
    the CRM reads), `page` clamped into range. **Inner**-joins companies for
    `companyName` (company is required), resolves delivery-manager names via a
    **single grouped follow-up query** over just this page's ids, and role counts via
    a **grouped count** — no N+1.
  - `createProject.ts` — gated `projects.edit`. One `db.transaction`: inserts the
    project, then bulk-inserts delivery-manager junction rows (deduped so a repeat
    can't trip the `unique` index) and role rows. The company must already exist
    (picked via search); the action only consumes ids. `revalidatePath("/projects")`.
  - `createProject.schema.ts` — the shared zod schema (pure, client-importable).
    Line-of-business values come from `@/lib/line-of-business`. Each role
    `.refine`s `endDate >= startDate`; `hoursPerDay` is coerced, positive, ≤24.
  - `searchStaff.ts` / `searchCompanies.ts` — type-ahead pickers, gated
    **`projects.edit`** (so a delivery manager can staff a project without gaining CRM
    write access). Their query bodies are the **shared** `searchStaffByName` /
    `searchCompaniesByName` in `src/actions/shared/entitySearch.ts` — the identical
    query the CRM `searchStaff`/`searchCompanies` now also delegate to. Same query,
    separate permission gates per domain.
- **UI** — `/projects` (`src/app/(app)/projects/page.tsx`) + `src/components/projects/**` —
  see [../ui.md](../ui.md). `projects-table.tsx` (columns: Name, Company, Delivery
  managers, Roles count) and `add-project-dialog.tsx` (create form with a
  `useFieldArray` roles repeater). A "Projects" nav entry (`IconBriefcase`) is in
  `src/components/app-shell/nav.ts`. New reusable components landed here:
  `src/components/crm/entity-combobox.tsx` (single-select sibling of
  `EntityMultiCombobox`, used for a role's one staff member) and
  `src/components/form/enum-select.tsx` (`EnumSelect`, extracted from
  `add-opportunity-dialog.tsx` for reuse).

## Authorization

**Reads are open** — any signed-in user can browse all projects (the `(app)` gate is
the boundary). **All project writes** are gated by a single flat capability (no
ownership dimension): **`projects.edit`**, granted to `delivery-manager`, `manager`,
`admin`. It covers creating projects and their staffing, plus the two type-ahead
pickers that back entry (`searchStaff`/`searchCompanies` in `src/actions/projects/`).
The page hides its "Add project" dialog for users without the capability; the action
gate is the real boundary. See [permissions.md](./permissions.md).

## Key flows

- **Create a project + staff it** (built) — pick a company, add delivery managers, add
  one or more role lines (staff + line of business + date range + hours/day), submit.
  One transaction writes it all. Create only today.
- **Won → Project handoff** _(proposed)_ — a won Opportunity (`status = closed_won`)
  should create/link the Project delivery staffs and bills against. Not built:
  projects are created standalone, with no back-reference to an opportunity. This is
  the CRM ↔ delivery seam — keep the link explicit when it lands. See
  [crm.md](./crm.md) and [flows.md](../flows.md).

## Connects to

- **CRM** — every project belongs to a `companies` row (required FK, `restrict`). The
  won-Opportunity → Project link is the proposed seam.
- **Staff** — delivery managers and role staff are `staff` rows. Delivery-manager FKs
  cascade; a role's `staffId` is `restrict`.
- **Allocations** — `project_roles` is the first concrete cut of the Allocation
  entity (see [allocations.md](./allocations.md), [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md)).
- **Timesheets / billing** — projects will be the thing time is logged against and
  billed for (proposed).

## Open questions / not yet built

- **Edit/delete** — only create + read exist. The `onDelete: restrict` on both
  `projects.companyId` and `project_roles.staffId` means a company- or staff-delete
  flow must handle live projects/roles.
- **Roles are simple rows, not effective-dated history** — a role's dates/hours are
  edited in place (once edit exists), not versioned like `staff_employment`. See
  [ADR 0017](../decisions/0017-project-roles-as-first-allocation-cut.md). Full
  capacity planning (over/under-allocation, conflicts, forecast vs. actuals) is still
  in the Allocations domain's open questions.
- No project status/stage, no budget/value, no rates.
</content>
</invoke>
