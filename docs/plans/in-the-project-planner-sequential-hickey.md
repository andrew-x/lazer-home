# Opportunity Project Planner — staff column, other-allocations, bulk actions, timeline stats

## Context

The **Project plan** tab of the opportunity drawer (`OpportunityProjectPlan`) is a weekly, Gantt-like planner. Today it renders **one row per person** (a person's roles collapse onto one line), a sticky "Role" column, and week columns whose cells are thin colored bars. It has no way to see a staffed person's *other* commitments, no bulk editing, and its only timeline signal is a "N wk" stat.

This change reshapes the planner to be **role-centric** and adds staffing context and bulk editing, so a delivery manager can plan a deal end-to-end from this one view:

1. A dedicated **Staff** column with an inline **Assign** control on unstaffed rows; once staffed, the row's timeline also shows that person's **other-project allocations, grayed**, with project name + % + tooltip (mirroring the Allocations view).
2. Week-column headers show the **full week date range** (e.g. `Aug 3 – Aug 9`) instead of just the Monday.
3. **Row checkboxes + bulk actions** on the deal's editable roles: **Delete**, **Bump timelines by X weeks** (shift start *and* end, preserving duration), **Duplicate** (copy roles *without* the assigned staff).
4. A summary stat for the **overall start–end dates**; when confirmed roles exist, also show **Confirmed** and **Tentative** timeline ranges.

Confirmed design decisions (from the user): **one row per role**; grayed cells adopt the **allocations-grid block style**; bump **shifts start and end together**.

Access control is unchanged — every mutation reuses the existing `projects: ["edit"]` gate and the `assertRoleEditable` invariant (role must be **tentative** and tagged with **this opportunity**). No `permissions.ts` / matrix changes.

---

## 1. Data layer — `src/actions/projects/getOpportunityPlan.ts`

Add the staff's **external allocations** to the plan payload.

- New type `ExternalAllocation` (staffId, roleId, projectName, roleType, status, lineOfBusiness, description, startDate, endDate, hoursPerDay) and add `externalAllocations: ExternalAllocation[]` to `OpportunityPlan`.
- After loading `roles`, collect the distinct non-null `staffId`s. If any, query `projectRoles` **inner-joined to `projects`** where `inArray(staffId, ids)`, `ne(projectRoles.projectId, projectRow.id)` (other projects only — same-project roles already appear as their own rows), and `inArray(status, ["tentative","confirmed"])` (same filter the allocations grid uses). Map rows to `ExternalAllocation` (project name from the join).
- Leave `timeline` (overall start/end) as-is; the confirmed/tentative split is derived client-side from `plan.roles`.

No new imports of `db` outside the actions layer; this stays a `server-only` read.

## 2. Grid math — `src/lib/projects/project-planner-grid.ts`

Rewrite from person-grouped to **role-centric**, and reuse the allocations percentage math.

- **Reuse** `weekPercent` from `@/lib/allocations/allocations-grid` (pure, client-importable) for both the own-role block % and the external blocks — do not re-derive the 40h math.
- New `PlannerRow` = one role: `{ key: 'role:<id>', roleId, roleLabel (description ?? PROJECT_ROLE_TYPE_LABELS[type]), roleTypeLabel, hoursPerDay, status, editable, staffId, staffName, startDate, endDate, weeks: PlannerCell[] }`.
- New `PlannerCell` = `{ own: { percent, isStart, isEnd } | null, external: ExternalBlock[] }`, one per week column. `ExternalBlock` mirrors `AllocationCell` (roleId, projectName, percent, status, roleType, lineOfBusiness, description, startDate, endDate, isStart, isEnd).
- `buildPlannerRows(roles, externalAllocations, weekColumns, currentOpportunityId)`:
  - One row per role. `editable = isEditable(role, currentOpportunityId)` (unchanged helper).
  - `own` per week via `weekPercent(role, week)` (null when 0); `isStart/isEnd` via `getWeekStart`.
  - `external` per week: filter `externalAllocations` by `staffId === role.staffId`, then `weekPercent > 0`.
  - **Sort**: editable (this-deal) rows first, then read-only; within each group by `startDate`, then `staffName ?? roleLabel`.
- `buildWeekColumns(roles)` unchanged (spine still from this project's roles; external work outside the window simply doesn't render — "in our timeline").
- `weekColumnLabel(weekStart)` → return a **range**: `"<short(Mon)> – <short(Sun)>"` using `getWeekDays(weekStart)[0]` and `[6]` with the existing `Intl` short formatter.

Update the accompanying unit test if present (`src/lib/projects/project-planner-grid.test.ts`): role-centric rows, external cells, range label.

## 3. Grid component — `src/components/projects/opportunity-plan/planner-grid.tsx`

Rework the hand-rolled `<table>` (keep it hand-rolled — it stays the intentional exception):

- **Checkbox column** (leftmost), rendered only when selection is enabled (`canManage`). Header = select-all **editable** rows; per-row checkbox only on editable rows. Add the shadcn **Checkbox** primitive first: `bunx --bun shadcn@latest add checkbox` (Base UI), then re-swap any Lucide icon import to Tabler per the UI rule.
- **Staff column** (new, after Role): staffed → name; editable + unstaffed → inline `EntityCombobox` (`searchAction={searchStaff}`) that calls the new `assignRoleStaff` action on select; non-editable → name or `—`.
- **Role column**: role label + type · hours; keep the per-row edit pencil (editable only) wired to `onEditRole(roleId)`.
- **Week cells**: widen to `min-w-28`. Render `PlannerCell` as stacked blocks (allocations-grid style): the `own` block highlighted by state — **editable** `border-primary bg-primary/15 font-medium`, **confirmed** `border-primary/40 bg-primary/10`, other → grayed — and each `external` block **grayed** (`border border-dashed border-foreground/20 bg-foreground/[0.04] text-muted-foreground`) with project name + `%` and a Base UI `Tooltip` (project, description/role · LoB, date range via `formatDate`, hrs/week, status · % of week). This mirrors `AllocationBlock` in `allocations-grid.tsx`; local block components (don't cross-import — the two grids are deliberately separate).
- Update `PlannerLegend`: "This deal", "Confirmed", "Other allocation (elsewhere)".
- Props: add `selectedRoleIds`, `onToggleSelect(roleId)`, `onToggleSelectAll()`, keep `onEditRole`, add `onAssignStaff` wiring (or let the cell call the action directly via `useAction`).

## 4. Selection + bulk actions — `src/components/projects/opportunity-plan/opportunity-project-plan.tsx` (`PlanEditor`)

- State `selectedRoleIds: Set<string>`, constrained to editable roles; clear on reload.
- **Bulk bar** shown above the grid when selection is non-empty: count + **Delete**, **Bump…**, **Duplicate**, **Clear**. Wire to the three new actions via `useAction` (toast on success/error, clear selection, `onChanged()` reload).
- **Bump** opens a tiny `BumpRolesDialog` (a number-of-weeks input; reuse `FormDialog`/`FormField`). Duplicate/Delete execute directly.
- Pass selection props into `PlannerGrid`; update the `buildPlannerRows` call to the new signature and pass `plan.externalAllocations`.

## 5. Summary stats — `PlanEditor`

Add timeline-date tiles using existing `StatCard` + `formatShortDate`:

- Helper `rangeOf(roles)` → `{ start, end }` (lexical min/max of ISO dates); reuse `plan.timeline` for overall.
- Add a **"Dates"** tile: `formatShortDate(start) – formatShortDate(end)` (hint `${weeks} wk`).
- When any confirmed role exists, add **"Confirmed"** and **"Tentative"** tiles (each the range over that status subset). Let the grid wrap responsively (e.g. `grid-cols-2 lg:grid-cols-4`).

## 6. New server actions — `src/actions/projects/` (all `secureActionClient`, `permission: { projects: ["edit"] }`, revalidate `/opportunities` + `/projects`)

Each mirrors `deleteProjectRole.ts`: run inside a `db.transaction`, calling `assertRoleEditable(tx, roleId, opportunityId)` for **every** id before mutating (per-role tentative + this-opportunity invariant). One action + one hand-written `*.schema.ts` per file.

- **`assignRoleStaff.ts`** — input `{ roleId, opportunityId, staffId: id.nullable() }`; assert editable, set `staffId`.
- **`deleteProjectRoles.ts`** — input `{ opportunityId, roleIds: id[].min(1) }`; assert each, `delete … inArray(id, roleIds)`.
- **`bumpProjectRoles.ts`** — input `{ opportunityId, roleIds, weeks: int }`; assert each, load their dates, update `startDate = addWeeks(start, weeks)`, `endDate = addWeeks(end, weeks)` (`addWeeks` from `timesheet-week.ts` shifts any date by `n*7` days; preserves duration; `weeks` may be negative).
- **`duplicateProjectRoles.ts`** — input `{ opportunityId, roleIds }`; assert each, load full rows, insert copies with fresh `generateId("proj-role")`, `staffId: null`, `status: "tentative"`, `opportunityId` = this opportunity, same projectId/lineOfBusiness/description/roleType/startDate/endDate/hoursPerDay.

## 7. Docs

After implementation, **dispatch the `librarian` subagent** to reconcile `/docs` (notably `docs/domains/projects.md`, `docs/domains/allocations.md`) with the role-centric planner, the external-allocation read, and the new bulk actions.

---

## Files

**Edit:** `src/actions/projects/getOpportunityPlan.ts`, `src/lib/projects/project-planner-grid.ts`, `src/components/projects/opportunity-plan/planner-grid.tsx`, `src/components/projects/opportunity-plan/opportunity-project-plan.tsx` · **New:** `assignRoleStaff.ts`(+schema), `deleteProjectRoles.ts`(+schema), `bumpProjectRoles.ts`(+schema), `duplicateProjectRoles.ts`(+schema), a `BumpRolesDialog` component, and `src/components/ui/checkbox.tsx` (via shadcn). Update `project-planner-grid.test.ts` if it exists.

**Reuse:** `weekPercent` (`@/lib/allocations/allocations-grid`), `addWeeks`/`getWeekDays`/`getWeekStart` (`@/lib/timesheets/timesheet-week`), `assertRoleEditable`, `searchStaff`, `EntityCombobox`, `StatCard`, `formatShortDate`/`formatDate`, `Tooltip`, `generateId`.

## Verification

1. `bun run check` (Biome + `tsc` + tests) and `bun run build`.
2. Manual (`bun run dev`): open an opportunity → **Project plan** tab and confirm:
   - One row per role; week headers show `Mon D – Sun D` ranges.
   - Unstaffed editable row shows an **Assign** combobox; assigning a person makes their **other-project** allocations appear grayed with name/%/tooltip; the assigned role's own block is highlighted.
   - Select editable rows → bulk **Delete**, **Bump X weeks** (start & end move together, duration preserved), **Duplicate** (copies appear as new unstaffed tentative rows).
   - Read-only (confirmed / other-opportunity) rows have **no** checkbox and can't be bulk-edited.
   - Stats show overall **Dates**, plus **Confirmed**/**Tentative** ranges when confirmed roles exist.
3. Confirm no RBAC drift: all new mutations gated `projects: ["edit"]` + `assertRoleEditable`; `bun run check` matrix test stays green.
