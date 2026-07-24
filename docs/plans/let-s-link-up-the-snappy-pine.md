# Link project references to the project detail page

## Context

The project detail page (`/projects/[id]`) already exists (`src/app/(app)/projects/[id]/page.tsx` → `ProjectDetailView`), but the **only** place in the app that links to it today is the projects list table. Everywhere else a project is displayed — the allocations grid, staff/own profile, the opportunity project-plan tab, and the CRM company/contact detail pages — renders the project name as **plain text**. Two doc comments (in `staff-projects-section.tsx` and `company-detail-view.tsx`) even still claim "there's no per-project detail route," which is now stale.

Goal: make a project name clickable wherever it appears (read-only surfaces), navigating to that project's detail page, using the app's canonical `InternalLink`. This is almost entirely a presentational change — the project `id` is already available in every target's data.

**Decisions (confirmed with user):**
- Scope = **all read-only spots**: the 3 named examples + CRM company detail (Projects & Referred projects) + contact detail (referred projects). The editable **timesheet** week grid is intentionally left as plain text.
- Allocations grid links **open in a new tab** (`target="_blank"`), mirroring the existing staff-name link in that same grid.

## Canonical pattern

`InternalLink` — `src/components/internal-link.tsx`: a `next/link` wrapper carrying the standard `text-primary underline-offset-4 hover:underline` styling. Use it for every navigation link:

```tsx
<InternalLink href={`/projects/${project.id}`}>{project.name}</InternalLink>
```

The allocations grid is the one exception — it uses a raw `next/link` `<Link>` with `target="_blank"` for its staff link; project links there should mirror that exact treatment (see below), not `InternalLink`.

## Changes

### 1. Allocations grid (needs a tiny data change)
- **`src/lib/allocations/allocations-grid.ts`** — add `projectId: string` to the `AllocationCell` type (~line 36) and populate it in `buildAllocationRows` (the `allocations.push({...})` block ~line 240) from `role.projectId`. `AllocationRoleRow` already carries `projectId` (`src/actions/allocations/getAllocationsGrid.ts:46`), so no action/query change is needed.
- **`src/components/allocations/allocations-grid.tsx`** — in `AllocationBlock` (~line 147), wrap the `allocation.projectName` span in a `next/link` `<Link href={`/projects/${allocation.projectId}`} target="_blank" rel="noopener noreferrer">` mirroring the staff link at lines 72-79 (`hover:underline`). Keep the tooltip name (line 157) as-is. Watch that the link sits *inside* the `TooltipTrigger`'s `render` element and doesn't break the tooltip; if nesting the anchor inside the trigger div is awkward, apply the link to the name span only.

### 2. Staff / own profile projects
- **`src/components/staff/staff-projects-section.tsx`** — wrap the project name (~line 26) in `<InternalLink href={`/projects/${project.id}`}>`. `StaffProjectSummary` already has `id`. Update the stale doc comment that says project names aren't links because there's no detail route. Covers both `/profile` and `/staff/[id]` since `ProfileView` is shared.

### 3. Opportunity project-plan tab
- **`src/components/projects/opportunity-plan/opportunity-project-plan.tsx`** — the `<h3>{plan.project?.name ?? "—"}</h3>` heading (~line 371). When `plan.project` exists, render the name as `<InternalLink href={`/projects/${plan.project.id}`}>`; keep the `"—"` fallback plain. `PlanProject` has `id`. (This tab is rendered inside the opportunity detail drawer, so this satisfies "link to the project from opportunities.")

### 4. CRM company detail
- **`src/components/crm/company-detail-view.tsx`** — link the project name in both the **Projects** section (~line 175) and **Referred projects** section (~line 224) via `InternalLink` (`project.id` available in both). Update the stale doc comment (~lines 33-34) claiming projects have no detail page.

### 5. CRM contact detail
- **`src/components/crm/contact-detail-view.tsx`** — in `ProjectTable` (~line 84), link the referred-project name via `InternalLink` (`project.id` available).

### Out of scope
- **Timesheet week grid** (`src/components/timesheets/timesheet-week.tsx`) — left as plain text per decision (editable data-entry grid).
- **Home/dashboard** — placeholder only, no real project references yet.

## Docs
After implementing, dispatch the **librarian** subagent with a summary (project references across allocations, staff profile, opportunities, and CRM detail pages now link to `/projects/[id]`; two stale "no detail route" comments removed) so `/docs` stays accurate.

## Verification
- `bun run check` (Biome + `tsc --noEmit` + tests) and `bun run build`.
- `bun run dev` and manually click through each surface:
  - `/allocations` — click a project cell → opens `/projects/[id]` in a new tab.
  - `/profile` and `/staff/[id]` — project names in the projects section link.
  - CRM: open an opportunity's detail drawer → Project plan tab → project name links.
  - A company detail page — both Projects and Referred projects names link.
  - A contact detail page — referred project names link.
  - Confirm the timesheet grid still shows plain text (unchanged).
