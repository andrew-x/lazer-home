# Project detail page

## Context

Projects today have **only a list view** (`src/app/(app)/projects/page.tsx` → `ProjectsTable`);
there is no per-project detail route. The only place a single project is shown in depth is the
opportunity drawer's "Project plan" tab — but that is keyed by `opportunityId`, scoped to one deal,
and embedded in a sheet rather than a routed page. Staff profiles even note that project names can't
link anywhere "because there's no per-project detail route."

This adds the first dedicated **project detail page** (`/projects/[id]`), giving each project:

- **Summary stats at the top** (like the opportunity project plan) and a **read-only Gantt timeline**
  of its roles across all opportunities.
- A **Roles** tab: every role in a table.
- A **Time off** tab: PTO for the project's people, split into **Upcoming** and **Past**.

Timeline is **read-only** (role editing stays in the opportunity planner, where mutations are
opportunity-scoped). The PTO tab is visible to anyone who can open the project — everyone sees **who
is away and when**, but the **leave type is masked** unless the viewer has the `pto.review` permission.

## What already exists (reuse, don't rebuild)

- **Planner timeline (read-only capable):** `PlannerGrid` + `PlannerLegend`
  (`src/components/projects/opportunity-plan/planner-grid.tsx`) — driven entirely by `rows`/`weekColumns`
  props; all mutation callbacks are optional, so omitting them yields a read-only grid with hover
  tooltips.
- **Grid math (pure, client-safe):** `buildWeekColumns`, `buildPlannerRows`, `weekColumnLabel`
  (`src/lib/projects/project-planner-grid.ts`). `buildPlannerRows(roles, external, weekColumns, currentOpportunityId)`
  marks a row `editable` only when it belongs to `currentOpportunityId` — pass `null` and nothing is
  editable (exactly what we want).
- **Stat tiles:** `StatCard` (`src/components/performance/stat-card.tsx`).
- **Tabs:** `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` (`src/components/ui/tabs.tsx`, Base UI, use
  `variant="line"`). Reference composition: `src/components/crm/company-detail-view.tsx`.
- **Detail table scaffold:** `DetailSection`, `DetailTable`, `TableEmpty` (`src/components/crm/detail-parts.tsx`).
- **Badges/labels:** `ProjectStatusBadge` (`src/components/projects/project-status-badge.tsx`),
  `PROJECT_ROLE_TYPE_LABELS`, `PTO_TYPE_LABELS` (`src/lib/staff/staff-enums.ts`),
  `deriveProjectStatus`/`deriveProjectLinesOfBusiness` (`src/lib/projects/project-derived.ts`).
- **PTO split logic:** `getStaffPto` (`src/actions/staff/getStaffPto.ts`) already splits upcoming/past and
  precomputes Mon–Fri `workingDays` — mirror its shape for the project-wide read.

No schema changes, no migrations, no seed changes.

## Implementation

### 1. New server-only read: `getProjectPlan(projectId)`
`src/actions/projects/getProjectPlan.ts` — a project-keyed sibling of `getOpportunityPlan`. Same query
logic (delivery managers, all `projectRoles` left-joined to staff, external allocations, derived
status/LoBs, timeline) but selected **by `projects.id`** instead of via the opportunity. **Return the
existing exported types** (`OpportunityPlan`/`PlanProject`/`PlanRole`/`ExternalAllocation`) — export a
`getProjectDetailPlan`-style return type re-using them (or re-export). Also select `companyId` +
`companyName` (join `companies`) for the header. Return `null` when the project id doesn't exist so the
page can `notFound()`. Follows the reads rule (`import "server-only"`, no `'use server'`).

### 2. New server-only read: `getProjectPto(projectId)`
`src/actions/projects/getProjectPto.ts`. Resolve the project's people = distinct `projectRoles.staffId`
(non-null) ∪ `projectDeliveryManagers.staffId`; fetch their `staffPto`; split `upcoming`/`past` (mirror
`getStaffPto`). Return per-span rows carrying `staffName`:

```ts
type ProjectPtoSpan = {
  id; staffId; staffName; startDate; endDate; workingDays;
  isPending: boolean;
  type: PtoType | null; // null unless the viewer may see leave type
};
type ProjectPtoView = { upcoming: ProjectPtoSpan[]; past: ProjectPtoSpan[]; canSeeType: boolean };
```

`canSeeType = userHasPermission(user, { pto: ["review"] })` via `getCurrentUser`. When false, set every
`type` to `null` **in the read** (don't rely on the client to hide it — mask at the source). `isPending`
is only meaningful to reviewers; gate it with `canSeeType` too. Sort upcoming soonest-first, past
most-recent-first, tie-break by `staffName`.

**DRY:** extract `countWorkingDays` out of `getStaffPto.ts` into a small pure module (e.g.
`src/lib/staff/pto-working-days.ts`) and import it in both reads.

### 3. Extract the summary-stat helpers (DRY)
The stat computations (`rangeOf`, `rangeLabel`, `yearHint`, `deliveryManagerLabel`) are currently
private in `opportunity-project-plan.tsx`. Extract them into a pure module
`src/lib/projects/plan-summary.ts` and refactor `opportunity-project-plan.tsx` to import them, so the
new page and the opportunity planner render identical stats from one source.

### 4. New route: `src/app/(app)/projects/[id]/page.tsx`
Server Component. `params` is a `Promise` in this Next build (see `projects/page.tsx` awaiting
`searchParams`). Await `params`, then `Promise.all([getProjectPlan(id), getProjectPto(id)])`. If the
plan is `null`, call `notFound()` (`next/navigation`). `export const metadata` or a dynamic title from
the project name. Pass the serializable data to a client `ProjectDetailView`. Viewing needs no extra
gate (matches the list page — authenticated users can view; the `(app)` layout enforces auth).

### 5. New client view: `src/components/projects/detail/project-detail-view.tsx`
- **Header:** project name (`h2`), `ProjectStatusBadge`, line-of-business `Badge`s, company link
  (`/companies/[id]`), delivery-manager names.
- **Summary stat row (top):** `StatCard` grid using `plan-summary.ts` (Length in weeks, Dates, Confirmed
  span, Tentative span, Delivery managers) — same set as the opportunity plan.
- **`Tabs` (`variant="line"`)** below the stats:
  - **Timeline:** `PlannerGrid` (read-only — pass `rows`/`weekColumns` from `buildWeekColumns` +
    `buildPlannerRows(roles, external, weekColumns, null)`, omit all callbacks) + `PlannerLegend`.
  - **Roles:** `DetailTable` — columns Staff (or "Open role" when `staffId` null), Role type, Description,
    Line of business, Status (`ProjectStatusBadge`), Dates, Hrs/day. `TableEmpty` when none.
  - **Time off:** two `DetailSection`s ("Upcoming" / "Past"), each a `DetailTable` — Person, Dates,
    Working days, and **Type** (+ pending badge) column shown **only when `canSeeType`**. `TableEmpty`
    per section.

### 6. Link into the page
Make the project **Name** cell in `src/components/projects/projects-table.tsx` a link to
`/projects/[id]` (Base UI: `<Button variant="link" render={<Link href=... />}>` or a styled `Link`).
Optional follow-up: link project names in `StaffProjectsSection` (it explicitly notes it can't today).

## Files

- **New:** `src/actions/projects/getProjectPlan.ts`, `src/actions/projects/getProjectPto.ts`,
  `src/lib/staff/pto-working-days.ts`, `src/lib/projects/plan-summary.ts`,
  `src/app/(app)/projects/[id]/page.tsx`, `src/components/projects/detail/project-detail-view.tsx`.
- **Edit:** `src/components/projects/opportunity-plan/opportunity-project-plan.tsx` (import extracted
  stat helpers), `src/actions/staff/getStaffPto.ts` (import extracted `countWorkingDays`),
  `src/components/projects/projects-table.tsx` (link the name).

## Permissions

- No new permission. Page view = authenticated (as list). Leave **type** and **pending** state are gated
  on `pto.review`, masked **in `getProjectPto`** (not the client). All DB access stays in the actions
  layer; no inline role checks — use `userHasPermission`.

## Verification

1. `bun run check` (Biome + `tsc` + tests) and `bun run build`.
2. `bun run dev`; open a project from `/projects` (name now links) → `/projects/[id]`.
   - Stats + read-only timeline render; hover tooltips work; no edit affordances.
   - Roles tab lists every role incl. open (unstaffed) placeholders.
   - Time off tab shows Upcoming/Past for assigned staff + delivery managers.
   - As a `pto.review` user: leave **type** column visible. As a non-reviewer: only dates/working days
     (type masked).
   - A bad id → not-found.
3. After merge, dispatch the **librarian** subagent to update `docs/domains/projects.md` (+ data-model
   flows) with the new detail page and the two reads.
