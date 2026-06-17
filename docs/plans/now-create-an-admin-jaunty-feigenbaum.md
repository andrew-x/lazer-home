# Plan: Bulk Edit Roles admin page (+ LEADERSHIP rename & `isManagement`)

## Context

We want a local-only admin tool to edit staff **employment facts** in bulk — role, line of
business, employment type, billability, utilization, billable type, and a new "is management"
flag — on one filterable, sortable table, committed in a single confirmed transaction.

Today employment facts can only be set via the CSV import (`/admin/upload-staff`); there is no
way to edit them in-app, and no way to set `isManagement` at all. This page becomes that
surface. It also completes the earlier-agreed schema change: rename the `role` enum value
`MANAGEMENT` → `LEADERSHIP` and add an `isManagement` boolean, so someone can hold a working
role (e.g. ENGINEER) **and** be flagged as management for it — instead of "management" being a
mutually-exclusive role.

This plan has two parts: **Part 1** is the schema/rename groundwork (a hard dependency of the
page); **Part 2** is the page itself.

---

## Part 1 — Schema: `LEADERSHIP` rename + `isManagement` (prerequisite)

### Schema — `src/lib/db/staff-schema.ts`
- `roleEnum`: rename value `"MANAGEMENT"` → `"LEADERSHIP"`.
- `staffEmployment`: add `isManagement: boolean().notNull().default(false)`.

### Migrations — `drizzle/`
Run `bun run db:generate`, then **hand-fix** the generated SQL (drizzle-kit can't detect an
enum-value rename and will emit a destructive drop/recreate):
- Replace the enum churn with: `ALTER TYPE "role" RENAME VALUE 'MANAGEMENT' TO 'LEADERSHIP';`
  (renames the label in place — existing rows follow automatically; no data backfill, so
  `isManagement` stays `false` for everyone — the agreed "rename only" migration).
- Keep the generated `ALTER TABLE "staff_employment" ADD COLUMN "is_management" boolean DEFAULT false NOT NULL;`.

### Import — keep `isManagement` out of the CSV path; preserve it across imports
`isManagement` is set in-app, never derived from CSV, so it does **not** join `NormalizedStaff`
/ the transform / the diff comparison. It is only carried forward when import spawns a new
employment row.
- `src/lib/staff-import/types.ts`: rename `"MANAGEMENT"` → `"LEADERSHIP"` in the `ROLE` tuple;
  add `isManagement: boolean | null` to `ComparableSnapshot`.
- `src/lib/staff-import/transform.ts`: rename `"MANAGEMENT"` → `"LEADERSHIP"` in `NON_BILLABLE_ROLES`.
- `src/lib/staff-import/plan.ts`: update the preservation check `current.role === "MANAGEMENT"`
  → `"LEADERSHIP"` (+ comment); add `isManagement` to the employment `select` and to the
  `current` snapshot.
- `src/actions/admin/commitStaffImport.ts`: in the `updates` loop, when `employmentChanged`
  inserts a new row, set `isManagement: current.isManagement ?? false` (carry forward so a
  LoB/role change never silently resets it). Creates use the DB default (`false`).

### Profile badge (small, agreed earlier)
- `src/actions/staff/getStaffProfile.ts`: add `isManagement` to the employment projection and
  the `StaffProfile["employment"]` type.
- `src/components/staff/profile-view.tsx`: render `<Badge variant="outline">Management</Badge>`
  beside the existing Billable badge (line ~82) when `employment.isManagement`.

Billability stays role-driven and untouched (`LEADERSHIP` remains in `NON_BILLABLE_ROLES`); the
flag never affects billability. The role filter dropdown auto-shows "Leadership" via
`humanizeEnum`.

---

## Part 2 — Bulk Edit Roles page

Mirror the admin import architecture: a local-only page under `src/app/admin/`, data loaded by
a `server-only` read in the actions layer, mutation through a `publicActionClient` action gated
by `assertLocalhost()`, recomputed/validated server-side (never trust the client payload).

### 2a. Read — `src/actions/staff/getStaffEmploymentForEdit.ts` (`server-only`)
Mirror the two-query, latest-per-staff approach in `getStaffDirectory.ts` (`desc(effectiveFromDate), desc(createdAt)`, first-seen wins). Return **every** staff member (active and inactive),
each with `id`, `name`, `isActive`, and their latest employment row's `employmentId`,
`effectiveFromDate`, and **all editable fields**: `lineOfBusiness`, `role`, `employmentType`,
`isBillable`, `utilizationTarget`, `billableType`, `isManagement`. Export a `StaffEmploymentEditRow`
type. Staff with no employment row are excluded (nothing to edit).
- Add `billableType: [...billableTypeEnum.enumValues]` to the exported filter options (extend
  `staffDirectoryFilterOptions` in `getStaffDirectory.ts`, or add a sibling export here) so the
  page gets option lists without importing the Drizzle schema directly.

### 2b. Commit action — `src/actions/admin/commitBulkEditEmployment.ts` + `.schema.ts`
- Client: `publicActionClient`, `.metadata({ action: "bulk-edit-employment", role: "admin" })`,
  `assertLocalhost()` first (mirrors `commitStaffImport`).
- Input schema (own `.schema.ts` file so the client can import it): 
  `{ effectiveDate: string | null /* YYYY-MM-DD */, changes: Array<{ staffId, lineOfBusiness, role, employmentType, isBillable, utilizationTarget (0–100 int), billableType (nullable), isManagement }> }`.
  Build the per-row shape from `createInsertSchema(staffEmployment).pick(...)` + `staffId`, with a
  `.refine` enforcing `isBillable === false ⇒ utilizationTarget === 0` (same invariant as the
  import's `normalizedStaffSchema`).
- Server logic (recompute against DB; ignore any client-side diffing):
  1. Fetch the latest employment row (`id`, all editable fields, `effectiveFromDate`) per
     `staffId` in `changes`.
  2. Validate: every `staffId` resolves to an employment row; the `isBillable`/target coupling
     holds; and **if `effectiveDate` is provided, it must be strictly after each affected
     staff's latest `effectiveFromDate`** — otherwise `throw new UserSafeActionError(...)`
     naming the offending staff. (Strictly-after per the spec; same-day corrections use the
     blank-date path instead.)
  3. Apply in one `db.transaction`:
     - **`effectiveDate` blank → in-place correction:** `UPDATE staff_employment` of each
       latest row (`where id = latest.id`) setting the changed fields + `updatedAt = now()`.
     - **`effectiveDate` set → new effective-dated rows:** `INSERT` one new row per changed
       staff: `generateId("staffEmployment")`, `effectiveFromDate = effectiveDate`, fields =
       latest row's values overridden by the change (carries forward unchanged facts incl.
       `isManagement`).
  4. `revalidatePath("/")`. Return `{ staffAffected, mode: "update" | "insert", rows }` for the
     success toast.

> **ADR 0007 note:** the blank-date in-place UPDATE is a deliberate *extension* of ADR 0007
> (which currently says employment changes always insert a new row). Semantics: blank =
> "correct a mistake" (no new historical fact); dated = "change effective on this date" (new
> row). The librarian must document this (likely an amendment to ADR 0007).

### 2c. Date picker — shadcn recipe on the project's Base-UI primitives
`components.json` style is `base-nova`, so `bunx --bun shadcn@latest add popover calendar`
resolves to the Base-UI variants (same UX as the linked shadcn date-picker, no Radix). Compose
a small `src/components/ui/date-picker.tsx` (or local to the page) per the shadcn date-picker
recipe: a `Button` trigger in a `Popover` opening a `Calendar`, value as `"YYYY-MM-DD"`
string, with a Clear affordance (clearing → blank → in-place mode). Re-swap any Lucide imports
the generator pulls for `@tabler/icons-react` per `.claude/rules/ui.md`.

### 2d. Page + client component
- Route: `src/app/admin/bulk-edit-roles/page.tsx` — Server Component; `await getStaffEmploymentForEdit()`
  and the filter options, pass to the client component. (Layout already localhost-gates the
  whole `/admin` segment.)
- Add an entry to `ADMIN_TOOLS` in `src/app/admin/page.tsx` (icon + "Bulk edit roles" → `/admin/bulk-edit-roles`).
- Client component `src/components/admin/bulk-edit-roles.tsx` (`"use client"`):
  - **Edit state:** a draft map keyed by `staffId` holding edited fields; a row's displayed value
    is `draft[id] ?? original`. A row is "changed" if any field differs from its original. A
    single global optional `effectiveDate`.
  - **Field coupling:** toggling `isBillable` off forces `utilizationTarget = 0` and disables the
    utilization + billable-type editors for that row (mirrors the import invariant).
  - **Filters** (client-side, mirror `staff-directory.tsx` helpers): name search (`Input` +
    `IconSearch`); `lineOfBusiness` and `role` as `Select` (All + options); `isBillable`,
    `isManagement`, and `isActive` as tri-state segmented `ToggleGroup` (All / Yes / No) —
    `isActive` **defaults to Yes (active only)**. Filtering via `useMemo`.
  - **Table** via `useReactTable` (core + `getSortedRowModel`; sortable headers). Pass the edit
    setter through `table.options.meta` so cell editors can update drafts. Columns: **Name**
    (read-only, links to `/staff/[id]`), **Line of business** (Select), **Role** (Select),
    **Employment type** (Select), **Billable** (`Switch`), **Utilization** (a very small/unobtrusive
    `0/50/100` `ToggleGroup` plus a small number `Input` for arbitrary values), **Billable type**
    (Select incl. a "None" option for null), **Management** (`Switch`). Reuse the vendored
    `Table` primitives (wraps in `overflow-x-auto`). Render with bottom padding (`pb-28`) so the
    last rows clear the floating bar.
  - **Floating save bar:** `fixed inset-x-0 bottom-0 z-40` hairline-bordered bar (no shadow per
    UI rules), shown when ≥1 row changed, showing the changed-row count + the effective-date
    `DatePicker` + a Save button. Save opens a confirmation `Dialog`.
  - **Confirm dialog:** a header line describing the mode ("Update each person's current
    employment record" when blank, or "Add a new employment record effective <date>" when set),
    then a per-staff list of `field: old → new` diffs (reuse the import `ChangeCell` styling:
    strike-through old, arrow, bold new). Confirm → `commit.execute({ effectiveDate, changes })`
    via `useAction`; toast on success/error off `result.serverError`; on success, reset drafts
    (or rely on `revalidatePath` + router refresh to reload fresh data).

---

## Files

**Create**
- `src/actions/staff/getStaffEmploymentForEdit.ts`
- `src/actions/admin/commitBulkEditEmployment.ts`
- `src/actions/admin/bulkEditEmployment.schema.ts`
- `src/app/admin/bulk-edit-roles/page.tsx`
- `src/components/admin/bulk-edit-roles.tsx`
- `src/components/ui/date-picker.tsx` (+ vendored `popover.tsx`, `calendar.tsx` via shadcn)
- `drizzle/00xx_*.sql` (generated, then hand-fixed for the enum rename)

**Modify**
- `src/lib/db/staff-schema.ts` (enum rename + `isManagement` column)
- `src/lib/staff-import/types.ts`, `transform.ts`, `plan.ts` (rename + preserve `isManagement`)
- `src/actions/admin/commitStaffImport.ts` (carry `isManagement` forward)
- `src/actions/staff/getStaffProfile.ts` + `src/components/staff/profile-view.tsx` (badge)
- `src/actions/staff/getStaffDirectory.ts` (extend filter options with `billableType`)
- `src/app/admin/page.tsx` (admin menu card)

**Reuse (don't rebuild)**
- Filter helpers/patterns: `src/components/staff/staff-directory.tsx`
- `ChangeCell` diff styling: `src/components/admin/staff-import.tsx`
- `useAction` + toast + `result.serverError` flow, `db.transaction` + `generateId("staffEmployment")`,
  `assertLocalhost`, `humanizeEnum`/`formatDate`, `cn`.

---

## Verification

1. `docker compose up -d` → `bun run db:generate` → **edit the migration** for the enum rename
   → `bun run db:migrate`. Confirm in `bun run db:studio` that existing `MANAGEMENT` rows now
   read `LEADERSHIP` and `is_management` exists defaulting to `false`.
2. `bun run check` and `bun run build` (type-check + lint) clean.
3. Manual on `http://localhost:3000/admin/bulk-edit-roles`:
   - Filters: search by name; filter by LoB/role; tri-state Billable/Management/Active (Active
     defaults to "Yes"); column sorting works.
   - Edit a row's role/LoB/type/billable/utilization/billableType/management; floating bar shows
     the changed count; last rows aren't hidden behind the bar.
   - Toggling Billable off forces utilization to 0 and disables those editors.
   - **Save with blank date** → confirm dialog shows correct diffs → commit → verify the *same*
     employment row was updated in place (no new row) in `db:studio`.
   - **Save with a future date** → commit → verify a *new* employment row was inserted with that
     `effectiveFromDate`; profile reflects the new current facts.
   - **Save with a past/same date** (≤ latest effectiveFromDate) → expect a `serverError` toast
     naming the offending staff; nothing written.
   - Set Management on someone → confirm the "Management" badge appears on their `/staff/[id]`
     profile.
4. Re-run a staff CSV import on a person with `isManagement = true` and a changed LoB → verify a
   new employment row is created with `isManagement` preserved (`true`), not reset.

## Docs
After implementation, dispatch the **librarian** subagent to reconcile `/docs`: the
`LEADERSHIP`/`isManagement` data-model change, the new admin page, and the ADR 0007 amendment
covering blank-date in-place updates vs. dated new rows.
```
