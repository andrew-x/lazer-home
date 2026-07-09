# Projects — new domain (page, data table, create form)

## Context

The PSA platform's data-model spine (`docs/data-model.md`) defines **Project** as
the hub that links CRM (a Company) to delivery (Allocations of People over time).
It is documented as _proposed_ — no schema, actions, route, or nav exist yet. This
change builds the first slice of that domain, mirroring the existing **opportunities**
feature (create + read-only table).

A project here is: a **name**, a required **company**, a set of **delivery managers**
(staff), and a list of **roles**. Each role is a staff member on a line of business
for a date range at N hours/day — which is effectively the proposed *Allocation*
entity, so this also lays the first stone of the allocations domain.

**Decisions (confirmed with the user):**
- Projects **require a company** (reuse the CRM `companies` link, like opportunities).
- Access is gated by a **new `projects.edit` capability** (not reused `crm.edit`).
- Scope is **create + read only**, exactly like opportunities (no edit/delete yet).

## Data shape

```
projects              : id, name, companyId → companies (restrict), createdAt, updatedAt
project_delivery_managers (junction) : id, projectId → projects (cascade), staffId → staff (cascade)
project_roles (child) : id, projectId → projects (cascade), staffId → staff (restrict),
                        lineOfBusiness (enum), startDate (date), endDate (date), hoursPerDay
```

- **Delivery managers** = many staff per project → junction table, exactly like
  `opportunity_owners` (surrogate `text` PK, `unique(projectId, staffId)`,
  `index(staffId)`, both FKs `cascade`).
- **Roles** = a child table (not a pure junction — it carries columns). `staffId`
  uses `onDelete: "restrict"` (a role without its person is meaningless; `staffId`
  is `notNull`). Index `projectId` and `staffId`.
- **`hoursPerDay`**: `numeric({ precision: 4, scale: 2 })` in number mode, DB default
  `"8"` (allows half-days like 7.5; zod `.default(8)`).
- **`lineOfBusiness`**: reuse the existing shared `lineOfBusinessEnum`
  (`CORPORATE | CORE | FINTECH | COMMERCE | DESIGN`) — do **not** invent a new type.
  It is documented as a shared/global enum for exactly this reuse.

## Files to create / modify

Follow the opportunities pattern precisely (files referenced below are the template).

### 1. Shared line-of-business tuple (enables client + zod reuse)
The enum currently lives only as a `pgEnum` (drizzle, not client-importable) in
`src/lib/db/staff-schema.ts`. To reuse it in the zod schema and the form select,
extract the values to a **pure module** and have both consumers import it (this is
the same single-source-of-truth pattern opportunities uses in
`createOpportunity.schema.ts`):
- **Create** `src/lib/line-of-business.ts` — `LINE_OF_BUSINESS` const tuple,
  `LineOfBusiness` type, and `LINE_OF_BUSINESS_LABELS: Record<LineOfBusiness,string>`.
- **Modify** `src/lib/db/staff-schema.ts` — `pgEnum("line_of_business", [...LINE_OF_BUSINESS])`
  (same values → no data/migration change to that enum).

### 2. Schema
- **Create** `src/lib/db/projects-schema.ts` — the three tables above + row types via
  `InferSelectModel` (repo forbids `Table.$inferSelect`). Template: `crm-schema.ts`
  (`opportunities` + `opportunity_owners`). Import `lineOfBusinessEnum` from
  `staff-schema.ts`, `companies`/`staff` from their schema modules.
- **Modify** `src/lib/db/schema.ts` — add `export * from "./projects-schema"`.
- Run `bun run db:generate` → `bun run db:migrate`.

### 3. Validation schema (pure, client-importable)
- **Create** `src/actions/projects/createProject.schema.ts` — template
  `createOpportunity.schema.ts`. Shape:
  ```
  name: string.trim().min(1).max(200)
  companyId: string.min(1, "Company is required.")
  deliveryManagerIds: array(string).default([])
  roles: array({ staffId: string.min(1), lineOfBusiness: z.enum(LINE_OF_BUSINESS),
                 startDate: date-string, endDate: date-string,
                 hoursPerDay: number.positive().max(24).default(8) })
         .default([])
  ```
  Add a `superRefine` (or per-item refine) so `endDate >= startDate`.
  Dates as `"YYYY-MM-DD"` strings (repo `date()` string-mode convention).

### 4. Actions
- **Create** `src/actions/projects/createProject.ts` — template `createOpportunity.ts`.
  `secureActionClient`, `metadata({ action: "create-project", permission: { projects: ["edit"] } })`,
  one `db.transaction` inserting the project row + delivery-manager rows + role rows.
  `generateId` prefixes: `"proj"`, `"proj-dm"`, `"proj-role"` (add these to
  `src/lib/db/ids.ts` if prefixes are enumerated there). Dedupe `deliveryManagerIds`.
  `revalidatePath("/projects")`.
- **Create** `src/actions/projects/getProjectsPage.ts` — `import "server-only"` read
  (NOT a `'use server'` action), template `getOpportunitiesPage.ts`. Return
  `Page<ProjectRow>` where `ProjectRow = { id, name, companyName,
  deliveryManagerNames: string[], roleCount: number }`. Use `innerJoin(companies)`
  for the name, one grouped follow-up query for delivery-manager names (avoid N+1),
  and a grouped `count` for roles. Reuse `pagination.ts` (`CRM_PAGE_SIZE`, `Page`,
  `clampPage`).
- **Staff/company search for the form pickers.** The existing `searchStaff.ts` /
  `searchCompanies.ts` are gated on `crm.edit`, so a `delivery-manager` (who gets
  `projects.edit` but not `crm.edit`) cannot call them. To avoid coupling and avoid
  widening CRM access:
  - **Create** `src/lib/search/staffSearch.ts` + `companySearch.ts` — pure
    server-only query helpers (the current query bodies extracted from the crm
    search actions).
  - **Modify** the crm `searchStaff.ts` / `searchCompanies.ts` to delegate to those
    helpers (behaviour unchanged, still `crm.edit`).
  - **Create** `src/actions/projects/searchStaff.ts` + `searchCompanies.ts` — same
    thin actions gated `permission: { projects: ["edit"] }`, delegating to the
    shared helpers. The project form uses these.

### 5. Permissions (RBAC — keep the three in lockstep)
- **Modify** `src/lib/permissions.ts` — add `projects: ["edit"]` to `statement`;
  grant it in the `roles` matrix to **`delivery-manager`, `manager`, `admin`**
  (delivery-managers own projects; this is the first capability that role gains).
- **Modify** `src/lib/permissions.test.ts` — assert the new capability per role.
- **Modify** `docs/domains/permissions.md` — reflect the new row.
- Run `/audit-rbac` after; `bun run check` runs the matrix test.

### 6. Components (`src/components/projects/`)
- **`projects-table.tsx`** — Server Component, hand-written shadcn `Table` primitives
  (template `opportunities-table.tsx`). Columns: **Name, Company, Delivery managers,
  Roles** (count). Empty state: "No projects yet."
- **`add-project-dialog.tsx`** (`"use client"`) — template `add-opportunity-dialog.tsx`,
  binding pattern **(b)** `useForm` + `useAction` (form shape ≠ action input; roles use
  `useFieldArray`). Fields:
  - Name → `Input`
  - Company → `CompanyComboboxField` (required; reuse as-is, but point its search at
    the projects-gated `searchCompanies` — confirm the field accepts a `searchAction`
    prop; if hard-wired to the crm action, add a prop).
  - Delivery managers → `EntityMultiCombobox` with `searchAction={searchStaff}` (projects one)
  - **Roles** → `useFieldArray` list; per row: single staff picker, line-of-business
    select, start date, end date, hours/day; plus remove button + "Add role" append.
    - Per-row staff is **single-select** — no single-entity staff combobox exists yet.
      **Create** `src/components/crm/entity-combobox.tsx` (`EntityCombobox`, the
      single-value sibling of `EntityMultiCombobox`, returns one `EntityOption`),
      driven by a `searchAction`. Reuse the `ui/combobox.tsx` primitive.
    - Line of business → the `EnumSelect` helper. **Extract** the `EnumSelect`
      currently defined inside `add-opportunity-dialog.tsx` into
      `src/components/form/enum-select.tsx` and import it in both places (DRY).
      Feed it `LINE_OF_BUSINESS` + `LINE_OF_BUSINESS_LABELS`.
    - Start/End date → `src/components/ui/date-picker.tsx`.
    - Hours/day → `Input type="number"`, default 8.
  - On submit: map form values → action input (`EntityOption[]` → `id[]`, roles →
    plain objects), client-side `createProjectSchema.safeParse`, map issues to fields
    (top-level via a typed `FIELD_FOR_ISSUE`; nested role issues keyed by
    `issue.path` e.g. `["roles", i, "endDate"]` → `setError(\`roles.${i}.endDate\`)`),
    then `execute(parsed.data)`. Close on `onSuccess`.

### 7. Page & nav
- **Create** `src/app/(app)/projects/page.tsx` — template
  `src/app/(app)/opportunities/page.tsx`. `metadata = { title: "Projects" }`; parse
  `?projectsPage=`; `Promise.all([getProjectsPage(page), getCurrentUser()])`;
  `canEdit = userHasPermission(user, { projects: ["edit"] })`; render header +
  `{canEdit ? <AddProjectDialog /> : null}` + `<ProjectsTable rows=... />` +
  `<PaginationControls basePath="/projects" paramKey="projectsPage" ... />` (reuse).
- **Modify** `src/components/app-shell/nav.ts` — add
  `{ title: "Projects", href: "/projects", icon: IconBriefcase }` (import a Tabler
  icon, e.g. `IconBriefcase` or `IconFolders`).

### 8. Docs (after implementation)
Dispatch the **librarian** subagent with a summary: new `projects` domain realizing
the proposed Project entity + first cut of allocations (roles). It should update
`docs/data-model.md`, add `docs/domains/projects.md`, and note the
Project↔Allocation relationship now partially exists.

## Repo conventions to honor
- Modified Next.js build — read `node_modules/next/dist/docs/` before writing route
  code; Base UI uses the `render` prop, not `asChild`.
- `text` PKs via `generateId(prefix)`, minted app-side. No uuid/sequences.
- All DB access through the actions layer; explicit column selects (never `select().from()`).
- Light-mode only, flat surfaces, sharp 4px corners, Tabler icons (see `.claude/rules/ui.md`).

## Verification
1. `bun run db:generate` && `bun run db:migrate` — migration applies cleanly.
2. `bun run check` — Biome + `tsc` + tests (incl. the permissions matrix test) pass.
3. `bun run build` — production build/type-check passes.
4. `bun run dev` — sign in, open **Projects** in the sidebar. As a permitted role,
   create a project: set name + company, add 1–2 delivery managers, add 2 roles with
   different lines of business and date ranges. Confirm it appears in the table
   (company, delivery-manager names, role count) and pagination works. Verify the
   "Add project" button is hidden for a role without `projects.edit`.
5. `/audit-rbac` — confirm the new capability is gated correctly and nothing bypasses it.
```
