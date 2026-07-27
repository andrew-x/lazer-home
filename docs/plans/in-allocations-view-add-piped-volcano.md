# Allocate staff to an open project role from the allocations view

## Context

The allocations planner (`/allocations`) is currently **read-only**: it shows every active
staff member with their staffed project-role spans, but there is no way to allocate someone
from this view. Staffing today only happens inside the opportunity planner, via actions that
are hard-scoped to an opportunity (`assertRoleEditable` requires a `tentative` role tagged with
a specific `opportunityId`).

We want managers to allocate a person directly from the planner. Each staff row gets an
**Allocate** button that opens a dialog to **search unallocated roles** (open positions —
`project_roles` rows with `staffId IS NULL`), then **adjust the date range and hours/day**
before saving. Saving assigns that person to the open role (and applies the adjusted dates/hours).

Two clarified decisions:
- **Search scope:** show **all** open roles (no line-of-business pre-filter).
- **Button placement:** a small `+` icon button **in the staff name cell** (sticky first column),
  shown only to users who can edit (`projects.edit`).

An "allocation" in this codebase is a `project_roles` row (`src/lib/db/projects-schema.ts:94`).
Assigning a person = setting that row's `staffId`. There is no separate allocation entity.

## Approach

Assign the staff member to an **existing** open role (the dialog searches open roles, so the
target row already exists). This is an *update* of `staffId` + `startDate`/`endDate`/`hoursPerDay`
on that row — not creating a new role. The existing `assignRoleStaff` cannot be reused: it is
opportunity-scoped and only writes `staffId`. We add a new, non-opportunity-scoped action.

### New server actions (`src/actions/allocations/`)

**1. `searchUnallocatedRoles.ts`** — type-ahead over open roles. Model on `searchProjects.ts`
(inline `secureActionClient`, `permission: { projects: ["edit"] }`, reuse `searchQuerySchema` +
`SEARCH_LIMIT` from `@/lib/core/search`, `escapeLike`, blank query → `[]`).
- Query `projectRoles` JOIN `projects`, `WHERE isNull(projectRoles.staffId) AND status IN
  ('tentative','confirmed')` and `ilike` on **project name OR role description** (mirror the
  `ilike(...)` predicate in `searchProjects.ts:41`).
- Return **rich rows** the dialog needs to prefill: `{ id, projectName, description, roleType,
  lineOfBusiness, startDate, endDate, hoursPerDay }`. (Richer than the generic `{id,name}`
  `SearchAction` contract, because selecting a role must prefill its current dates/hours — see
  dialog note below.) Export the row type.

**2. `allocateStaffToRole.ts` + `allocateStaffToRole.schema.ts`** — the save.
- Action: `secureActionClient.metadata({ action: "allocate-staff-to-role", permission: {
  projects: ["edit"] } }).inputSchema(...).action(...)`.
- In a transaction: load the role; **guard with `throw new UserSafeActionError(...)`** if it is
  missing, already has a `staffId`, or is not `tentative`/`confirmed` (prevents overwriting an
  already-staffed role or racing another assignment). Then `update` the row setting `staffId`,
  `startDate`, `endDate`, `hoursPerDay`. Leave `status` unchanged (assigning a person is not a
  planning-status change).
- `revalidatePath("/allocations")` + `revalidatePath("/projects")` + `revalidatePath("/opportunities")`
  (the role is shared across those views).
- Schema (`allocateStaffToRole.schema.ts`): **hand-written, client-importable, drizzle-free**
  (the dialog imports it). `{ roleId: id, staffId: id, startDate: dateString, endDate: dateString,
  hoursPerDay: z.coerce.number().positive().max(24) }` with the shared `endOnOrAfterStart`
  refinement. Reuse primitives: `@/lib/schemas/date-schema` (`dateString`, `endOnOrAfterStart`),
  the id schema, and the `hoursPerDay` shape from `src/actions/projects/projectRole.schema.ts:30`.
  Export `AllocateStaffToRoleInput = z.infer<...>`.

### Grid read — thread a `canAllocate` flag (mirror `canEditNotes`)

`src/actions/allocations/getAllocationsGrid.ts`: add `canAllocate` to `AllocationsGridData` (:74),
computed as `currentUser ? userHasPermission(currentUser, { projects: ["edit"] }) : false`
(next to the existing `canEditNotes` at :154) and return it. No other read change — the button
is purely additive.

### UI

**`src/components/allocations/allocate-dialog.tsx`** (new). Build from
`src/components/projects/opportunity-plan/role-dialog.tsx` (loose `useForm` + `useAction` +
manual `safeParse` → `applyServerIssues`) and `extend-dialog.tsx`:
- Props: the target `{ staffId, staffName }` + open/close control (state-driven, see below).
- **Role search + select:** reuse the debounced-search pattern behind `EntityCombobox`
  (`src/components/form/entity-combobox.tsx`) driving `searchUnallocatedRoles`. Because selecting
  a role must **prefill** the date/hours fields from that role, the dialog keeps the selected rich
  role object in state (label each result e.g. `"{projectName} — {description ?? roleType}
  ({startDate}→{endDate})"`). Implementation note: if `EntityCombobox`'s `{id,name}`-only
  selection can't carry the extra fields, render results with the same underlying combobox
  primitive `EntityCombobox` uses and store the full selected row — do **not** add a second round
  trip.
- On role select: prefill `startDate`/`endDate`/`hoursPerDay` from the role; user can edit them
  via `DatePicker` (`@/components/ui/date-picker`) ×2 and `Input type="number" step="0.5" min="0"
  max="24"` (copy `role-dialog.tsx:236-287`).
- `FormDialog` / `FormDialogFooter` shell (`@/components/form/form-dialog`), footer wired with
  `serverError={x.result.serverError}` and `loading={x.isPending}`. `onSuccess` → close dialog.

**`src/components/allocations/allocations-grid.tsx`** — add a `+` `IconButton` (guarded by a new
`canAllocate` prop) inside the sticky staff cell (:129, beside the name `Link`/badge), calling an
`onAllocate(row)` callback prop.

**`src/components/allocations/allocations-planner.tsx`** — hold `useState` for the target staff
`{ staffId, name } | null`; pass `canAllocate` (from `data.canAllocate`, :59-area) and
`onAllocate={(row) => setTarget(...)}` to `AllocationsGrid`; render `<AllocateDialog>`
conditionally with a `key` on the target (remount-on-open, mirroring
`opportunity-project-plan.tsx:552-564`).

## Files

Create: `src/actions/allocations/searchUnallocatedRoles.ts`,
`src/actions/allocations/allocateStaffToRole.ts`,
`src/actions/allocations/allocateStaffToRole.schema.ts`,
`src/components/allocations/allocate-dialog.tsx`.

Modify: `src/actions/allocations/getAllocationsGrid.ts`,
`src/components/allocations/allocations-planner.tsx`,
`src/components/allocations/allocations-grid.tsx`.

## RBAC (must hold)

- Both new actions gated `permission: { projects: ["edit"] }` (granted to `delivery-manager`,
  `manager`, `admin` — `src/lib/auth/permissions.ts`). Matches `assignRoleStaff`.
- The button/dialog are gated client-side by `canAllocate`, but the **server actions are the real
  gate** — never rely on hiding the button alone.
- No matrix change (reusing existing `projects.edit`), so `permissions.ts` / `permissions.test.ts`
  / `docs/domains/permissions.md` stay untouched.

## Verification

1. `bun run check` (Biome + `tsc` + tests) and `bun run build`.
2. Manual (`bun run dev`) as a **manager/admin**:
   - `/allocations` → each staff row shows a `+` button. Click it → dialog opens.
   - Search finds open roles (create an unstaffed role via the opportunity/project planner first if
     the seed has none); selecting one prefills its date range + hours.
   - Adjust dates/hours, save → dialog closes, the staff row now shows the new allocation span in
     the grid.
   - Try an end-before-start range → inline validation error, no save.
3. Sign in as a **`user`** role → the `+` button is absent, and invoking `allocateStaffToRole`
   would be rejected server-side.
4. After implementation, **dispatch the `librarian` subagent** to reconcile `docs/domains/allocations.md`
   (and the data-model/flows docs) with the new create-allocation path.
