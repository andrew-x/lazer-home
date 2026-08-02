# Allocations — a by-project view

## Context

`/allocations` today answers **"what is this person on?"** — rows are active staff,
columns are day/week/month buckets, cells are the projects they're allocated to.
Delivery planning needs the mirror question: **"is this project staffed?"** That view
doesn't exist, and one class of data is currently invisible anywhere in the planner —
**open positions**. `getAllocationsGrid` filters to `isNotNull(projectRoles.staffId)`,
so an unstaffed role (a `project_roles` row with no person) never renders. Today the
only way to see a staffing gap is to open each project, or to type-ahead blindly in
the Allocate dialog's role picker.

This adds a second view at `/allocations?view=project`: **projects as collapsible
rows, their roles as subrows**, cells showing the assigned person or an
**Unallocated** block, both carrying the role's share of an 8h day. Clicking an
Unallocated block staffs that role in place. Filters cover date range, line of
business, role type, status, and staffed/unstaffed.

The existing staff view is untouched.

## Decisions taken

- **Percentage** = the existing `bucketPercent` (`hoursPerDay / 8h`, week columns
  prorate partial start/end weeks). Same math the staff view shows — no second
  definition of "how loaded is this".
- **A collapsed project row shows a rollup** per column: total allocated FTE plus a
  count of open roles (`3.5 FTE · 2 open`), so the grid is useful collapsed.
- **Status "All" means tentative + confirmed only.** `paused`/`cancelled` roles never
  appear, matching the staff view's definition of an allocation.
- **Unallocated blocks are actionable** for `projects.edit` holders — a role-first
  allocate dialog (the inverse of today's staff-first one) reusing the existing
  `allocateStaffToRole` action. No new action, schema, or permission.
- **No time off in this view.** PTO is a property of a person, not a project row; the
  staff view remains where availability lives.
- **Row order:** projects with an open role in the window first, then alphabetical —
  the project-side analogue of the staff view's "surface capacity first" sort.

## Files

### 1. Read — `src/actions/allocations/getProjectAllocationsGrid.ts` (new)

A `import "server-only"` read beside `getAllocationsGrid.ts`, same open-read posture
(no metadata gate — project-role reads are open by design; keep the existing comment's
reasoning). One query: `projectRoles` inner-joined to `projects` and **left**-joined to
`staff` (a role may have no person), `where status in ('tentative','confirmed')` —
note the **absence** of the `isNotNull(staffId)` filter is the point of this read.
Project explicit columns only (see `.claude/rules/database.md`).

Returns:

```ts
export type ProjectAllocationRoleRow = {
  id: string; projectId: string; projectName: string; companyName: string;
  roleType: ProjectRoleType; status: ProjectRoleStatus; lineOfBusiness: LineOfBusiness;
  description: string | null; startDate: string; endDate: string; hoursPerDay: number;
  staffId: string | null; staffName: string | null;   // null ⇒ open position
};
export type ProjectAllocationsGridData = {
  roles: ProjectAllocationRoleRow[];
  canAllocate: boolean;   // userHasPermission(user, { projects: ["edit"] })
};
```

Re-export the filter option tuples the planner needs (`PROJECT_ROLE_TYPES`,
`LINE_OF_BUSINESS`) the way `allocationsFilterOptions` does, so the page never imports
the schema.

### 2. Grid math — `src/lib/allocations/project-allocations-grid.ts` (new)

Pure, client-importable, no React — the sibling of `allocations-grid.ts`, and it
**imports from it** rather than re-deriving: `Granularity`, `buildColumns`,
`defaultWindow`, `columnLabel`, `bucketPercent`, `WORKING_DAYS_PER_WEEK`.

```ts
type ProjectRoleCell = { percent: number; isStart: boolean; isEnd: boolean };
type ProjectRoleLine = { /* role identity + LoB/type/status/dates/hours/staff */ cells: ProjectRoleCell[] };
type ProjectSummaryCell = { fte: number; openCount: number };
type ProjectAllocationRow = { projectId; projectName; companyName; roles: ProjectRoleLine[]; cells: ProjectSummaryCell[] };

buildProjectAllocationRows(roles, columns, granularity): ProjectAllocationRow[]
```

- Per role/column: `percent = bucketPercent(role, granularity, colStart)`; `isStart` /
  `isEnd` computed exactly as `buildAllocationRows` does (bucket-start equality).
- Per project/column: `fte = sum(percent) / 100` over roles active that column
  (rounded to 1 dp); `openCount` = roles active that column with `staffId === null`.
- A role with `percent === 0` in **every** column is dropped (it doesn't touch the
  window); a project with no surviving roles is dropped.
- Sort: any-open-role-in-window first, then `projectName.localeCompare`.

Tests in `src/lib/allocations/project-allocations-grid.test.ts`, following
`allocations-grid.test.ts` — cover the FTE rollup, `openCount`, the drop-outside-window
rule, week proration at the edges, and the sort.

### 3. Shared column widths — `src/components/planner/planner-columns.ts` (edit)

Lift the private `COLUMN_WIDTH: Record<Granularity, string>` out of
`allocations-grid.tsx` into this module as `PLANNER_COLUMN_WIDTH` (keeping the literal
Tailwind strings and the `table-fixed` note), and have **both** grids import it. One
definition of how wide a day/week/month column is.

### 4. Grid component — `src/components/allocations/project-allocations-grid.tsx` (new)

A hand-rolled `<table class="table-fixed">` in the same idiom as `allocations-grid.tsx`
and `opportunity-plan/planner-grid.tsx` — **not** `@/components/ui/table`, and **not**
`EditableTable` (one `<tr>` per row means it can't hold subrows; see
`.claude/rules/ui.md`). Expansion is a `Set<string>` of project ids in the parent, the
pattern from `performance/compensation-plans/plan-editor.tsx`.

- Sticky left column (`PLANNER_LABEL_COL`). Project row's label cell is a real
  `<button>` with `aria-expanded` and an `IconChevronRight`/`IconChevronDown`, project
  name linking to `/projects/[id]` (new tab, as the staff view links names), company
  name as the sublabel.
- Project row cells: `3.5 FTE` with `tabular-nums`, and `N open` beneath in muted text
  when `openCount > 0`.
- Role subrows render only when expanded, indented, labelled
  `description ?? PROJECT_ROLE_TYPE_LABELS[roleType]` with `LINE_OF_BUSINESS_LABELS[lob]`
  as the sublabel.
- Role cell blocks reuse `AllocationBlock`'s exact treatment: confirmed
  `border-primary/40 bg-primary/10`, tentative `border-dashed border-primary/50`, the
  leading/trailing `isStart`/`isEnd` bars, and the same tooltip content (role · LoB ·
  dates · `hoursPerDay × WORKING_DAYS_PER_WEEK` hrs/week · status · "% of {unit}").
  Staffed blocks show the person's name linking to `/staff/[id]`.
- **Unallocated block**: visually distinct from tentative — dashed neutral
  (`border-dashed border-foreground/25 bg-foreground/[0.04] text-muted-foreground`),
  label "Unallocated" + percent. When `canAllocate`, it renders as a button that calls
  `onStaffRole(role)`; otherwise a plain div.
- Day granularity dims weekend columns via `isWeekend`, as today.
- Extend `AllocationsLegend` (or add a sibling) with the Unallocated swatch.

### 5. Role-first allocate dialog — `src/components/allocations/staff-role-dialog.tsx` (new)

The mirror of `allocate-dialog.tsx`: the **role is fixed**, the person is picked.
`EntityCombobox` + `searchStaff` (`src/actions/projects/searchStaff.ts`) for the staff
field; start/end date and hours/day prefilled from the role and editable, exactly as
the existing dialog prefills them from the picked role. Submits the existing
`allocateStaffToRole` with `allocateStaffToRoleSchema` (`roleId` fixed, `staffId` from
the picker) via `useForm` + `useAction` and `applyServerIssues`. The action is already
`projects.edit`-gated and already guards inside its transaction that the role is still
open and live — **no permission or action changes**. It already
`revalidatePath("/allocations")`.

### 6. View toggle — `src/components/allocations/allocations-view-toggle.tsx` (new)

A near-copy of `staff-view-toggle.tsx`: link-based segmented switch using
`buildListHref("/allocations", "page", params, { view })`, `IconUsers` (By staff,
`view` absent) / `IconBriefcase` (By project, `view=project`). Keeping the choice in
the URL makes a project view deep-linkable; everything inside each view stays in-memory
filtering, so `?view=` remains the only allocations param.

### 7. Planner shell — `src/components/allocations/project-allocations-planner.tsx` (new)

Client component mirroring `allocations-planner.tsx`'s structure and control set.
State: `search`, `lineOfBusiness`, `roleType`, `status`, `staffing`, `granularity`,
`start`, `end`, `expanded`, `staffRoleFor`. Range + granularity controls
(`PlannerRange`, the `GRANULARITIES` `ToggleGroup`, `changeGranularity` re-seeding the
window) are lifted verbatim.

Filters, all in-memory over `data.roles`, all from `@/components/form/filters`:

| Filter | Control | Matches |
|---|---|---|
| Project | search `Input` | `projectName` / `companyName` contains |
| Line of business | `SelectFilter` + `LINE_OF_BUSINESS_LABELS` | `role.lineOfBusiness` (the **role's** LoB — roles carry it directly) |
| Role | `SegmentedFilter` + `PROJECT_ROLE_TYPE_LABELS` (5 values, so segmented not multi-select) | `role.roleType` |
| Status | `SegmentedFilter` | `ALL` \| `tentative` \| `confirmed` |
| Staffing | `SegmentedFilter` | `ALL` \| `Staffed` (`staffId !== null`) \| `Unstaffed` |

Filtering applies to **roles**; a project vanishes when none survive. Empty states
mirror the staff view's two messages.

### 8. Page — `src/app/(app)/allocations/page.tsx` (edit)

Take `searchParams: Promise<SearchParams>`, resolve
`const view = firstParam(params.view) === "project" ? "project" : "staff"` (unknown →
staff, matching `/staff`), fetch **only** the read that view needs, render
`<AllocationsViewToggle current={view} params={params} />` in the header alongside a
view-appropriate subtitle ("Who's staffed on what" / "How each project is staffed,
role by role").

### 9. Docs

Dispatch the `librarian` subagent with a summary of the change: `docs/domains/allocations.md`
gains a *By-project view* section (rollup semantics, the status scope, unstaffed roles now
visible), and `docs/domains/projects.md` notes that open positions surface in the planner.
Let it judge whether the FTE-rollup + "All = live only" call warrants a short ADR.

## Verification

1. `bun run check` — Biome, `tsc --noEmit`, and the new grid-math tests.
2. `bun run build`.
3. `bun run dev`, then walk `/allocations?view=project`:
   - Toggle round-trips between the two views and the URL updates; deep-linking
     `?view=project` lands on the project view.
   - Expand/collapse a project; the FTE rollup equals the sum of its role percentages
     for that column, and `N open` matches the Unallocated blocks visible when expanded.
   - Switch day/week/month — the range re-seeds and role percentages match the same
     roles' percentages in the staff view.
   - Each filter narrows as expected; Unstaffed shows only open roles; Status
     tentative/confirmed partition the "All" set; no paused/cancelled role ever appears.
   - As a `projects.edit` holder, click an Unallocated block, assign a person, and
     confirm the block flips to their name on revalidate and the same role now shows
     on that person's row in the staff view.
   - As a viewer **without** `projects.edit`, confirm Unallocated blocks are inert
     (not buttons) and the dialog is unreachable.
4. `/audit-rbac` — nothing here adds a gate, but the new read must be confirmed to
   expose no more than the existing project-role reads already do.
