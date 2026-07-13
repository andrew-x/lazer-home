# Design: Line of business on opportunities & projects; schema split; require ≥1 role

**Date:** 2026-07-13
**Status:** Approved design — ready for implementation plan

## Goal

Five connected changes across CRM + projects:

1. Move opportunities into their own Drizzle schema file (out of `crm-schema.ts`).
2. Add a required `lineOfBusiness` to **opportunities**.
3. Add a required `lineOfBusiness` to **projects**.
4. When creating a project from an opportunity, default the project's line of
   business to the opportunity's (overridable).
5. Remove `lineOfBusiness` from **project roles**.
6. Require at least one role when creating a project.

`lineOfBusiness` reuses the existing shared enum (`@/lib/line-of-business` →
`lineOfBusinessEnum` in `staff-schema.ts`). No new enum values.

## Decisions

- Opportunity LOB: **required** (`notNull`).
- Project LOB: **required** (`notNull`).
- Existing rows: **backfill to `CORE`** in the migration, then enforce `notNull`.
- Project create form: **pre-seed one empty role row** so the "at least one role"
  requirement is obvious, plus a validation message as a backstop.

## Changes

### 1. Schema split — `src/lib/db/opportunities-schema.ts` (new)

Move out of `crm-schema.ts`:

- `opportunitySourceEnum`, `opportunityStatusEnum`
- `opportunities`
- `opportunityContacts`, `opportunityOwners`, `opportunitySourceContacts`,
  `opportunitySourceStaff`
- The `InferSelectModel` row types for all of the above.

`crm-schema.ts` keeps `companies` + `contacts` (and their types). The new file
imports `companies`/`contacts` from `./crm-schema` and `staff` from
`./staff-schema`. Add `export * from "./opportunities-schema"` to the
`schema.ts` barrel. `projects-schema.ts` updates its `opportunities` import to
`./opportunities-schema`.

### 2. Line of business on `opportunities` (required)

- Table: add `lineOfBusiness: lineOfBusinessEnum().notNull()`.
- `createOpportunity.schema.ts` + `updateOpportunity.schema.ts`: add
  `lineOfBusiness: z.enum(LINE_OF_BUSINESS)`.
- `createOpportunity.ts` / `updateOpportunity.ts`: write the column.
- `getOpportunity.ts` / `getOpportunityDetail.ts`: project the column.
- UI: add a line-of-business `EnumSelect` (options `LINE_OF_BUSINESS`, labels
  `LINE_OF_BUSINESS_LABELS`) to the create dialog (`add-opportunity-dialog.tsx`)
  and the edit form (`opportunity-detail-sheet.tsx`). Update the form
  `*FieldValues`, defaults, and `FIELD_FOR_ISSUE`/issue maps.

### 3. Line of business on `projects` (required)

- Table: add `lineOfBusiness: lineOfBusinessEnum().notNull()`.
- `createProject.schema.ts`: add top-level `lineOfBusiness: z.enum(LINE_OF_BUSINESS)`
  (a project-wide field, not per-role).
- `createProject.ts`: write the column.
- UI (`add-project-dialog.tsx`): add a project-level LOB `EnumSelect` near the
  company field; add to `ProjectFormValues`, defaults, and `FIELD_FOR_ISSUE`.

### 4. Handoff default

- `getOpportunityDetail` already feeds the detail sheet. Pass the opportunity's
  `lineOfBusiness` into `AddProjectDialog` as a new `defaultLineOfBusiness` prop,
  which sets the project form's LOB default (still editable).

### 5. Remove line of business from role

- `projects-schema.ts`: drop `lineOfBusiness` from `projectRoles`.
- `createProject.schema.ts`: remove it from `projectRoleSchema`.
- `createProject.ts`: stop writing it in the role insert.
- `add-project-dialog.tsx`: remove the per-role LOB `EnumSelect`, the
  `RoleFieldValues.lineOfBusiness` field, its `EMPTY_ROLE` entry, and its
  `ROLE_FIELD_FOR_ISSUE` mapping.

### 6. Require ≥1 role on project create

- `createProject.schema.ts`: `roles: z.array(projectRoleSchema).min(1, "Add at least one role.")`
  (drop `.default([])`).
- `add-project-dialog.tsx`: pre-seed `roles` default with one `EMPTY_ROLE`;
  update empty-state copy; surface the array-level `roles` error.

### 7. Migration

- `bun run db:generate`, then hand-edit the generated SQL:
  - `opportunities.line_of_business` and `projects.line_of_business`: add with
    `DEFAULT 'CORE'`, backfill, then `DROP DEFAULT` (keep `NOT NULL`).
  - Drop `project_roles.line_of_business`.
- `bun run db:migrate`.

### 8. Docs

- After implementation, dispatch the `librarian` subagent to reconcile
  `docs/data-model.md`, `docs/domains/crm.md`, and `docs/domains/projects.md`
  (LOB now on opportunity + project, not role; opportunities live in their own
  schema file).

## Verification

- `bun run check` (Biome + `tsc` + tests) and `bun run build`.
- Drive the flows: create an opportunity (LOB required), create a standalone
  project (LOB + ≥1 role required), and create a project from an opportunity
  (LOB pre-filled from the opportunity, overridable).

## Out of scope

- No changes to allocations/timesheets (not yet built).
- No new LOB enum values or relabeling.
- No editing of a project's LOB after creation beyond what the create form covers
  (no project edit form exists yet).
