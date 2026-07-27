# Projects list → grid card view

## Context

The `/projects` page currently renders a flat, creation-ordered **table** with server-side pagination (`getProjectsPage` + `PaginationControls`) and **no filtering**. We want a scannable **grid of cards** grouped by how the team thinks about the portfolio:

- Three sections, in order: **Tentative** → **Active** (confirmed & ongoing) → **Other** (paused / cancelled). Tentative and Active render **in full**; **Other is server-paginated** — paused/cancelled projects accumulate unbounded over time, so we must not fetch them all.
- A **search box** (matches project **name or client company name**) and a **line-of-business filter**.
- **When any filter is active** (non-empty search OR a chosen line of business), the sections collapse into a **single flat, paginated grid** across all statuses; clearing filters restores the three sections.
- Each **card** shows: project name, client company, status badge, line(s) of business, delivery managers, date range.

Status and line-of-business are **derived from a project's roles** (`deriveProjectStatus` / `deriveProjectLinesOfBusiness` in `src/lib/projects/project-derived.ts`), not stored columns.

## Approach: server-side, URL-backed (the CRM list pattern)

Because Other must be paginated **and** we must select "all Tentative + all Active" without fetching the whole table, membership in each status bucket has to be decided **in SQL** — we can't derive status in JS from a full fetch. This mirrors exactly what the app already does: `getCompaniesPage.ts` re-expresses `deriveProjectStatus(...) === "confirmed"` as a correlated `exists`/`notExists` SQL predicate (`hasConfirmedProject`). We generalize that to all three buckets.

State lives in the **URL** (`q`, `lob`, `projectsPage`), like `getOpportunitiesPage` / `OpportunitiesListFilters`, so we reuse `buildListHref`, `firstParam`, `PaginationControls`, `SelectFilter`, and the debounced-search pattern verbatim, and get shareable/bookmarkable list state for free.

> **Lockstep note (must-fix drift found during planning):** the comments in `getCompaniesPage.ts` and `project-derived.ts` claim `src/lib/projects/project-derived.test.ts` guards the SQL↔JS "confirmed" agreement — **that test does not exist.** This plan creates it and extends it to cover all three buckets, so the new SQL predicates can't silently drift from `deriveProjectStatus`.

## Changes

### 1. Derived-status SQL predicates — `src/lib/projects/project-status-sql.ts` (new, server-only)

A reusable builder returning a correlated `SQL` predicate that selects projects whose **derived** status falls in a given bucket, correlated to the outer `projects.id` (same technique as `hasConfirmedProject`). `deriveProjectStatus` depends only on **which** role statuses are present (not counts), so each bucket is a boolean combination of `exists(role with status = X)`:

```ts
export type ProjectStatusBucket = "tentative" | "active" | "other";

// existsRole(cond) = exists(select 1 from project_roles
//                           where project_id = projects.id and <cond>)
// tentative : notExists(anyRole)  OR  existsRole(status='tentative')
// active    : existsRole(status='confirmed') AND notExists(status IN ('tentative','paused'))
// other     : NOT tentative AND NOT active     // == paused ∪ cancelled (buckets partition)
export function derivedStatusCondition(buckets: ProjectStatusBucket[]): SQL | undefined;
```

`active` is literally the existing `hasConfirmedProject` body. `other` is defined as the complement of tentative∪active so it can't drift out of partition. Returns `undefined` when `buckets` covers all statuses (no filter needed — used by the flat filtered view).

### 2. Agreement test — `src/lib/projects/project-derived.test.ts` (new)

The file the existing comments already promise. `deriveProjectStatus` is fully determined by the 4 presence flags `{hasTentative, hasConfirmed, hasPaused, hasCancelled}` (16 combinations). Enumerate all 16, and for each: build a representative `roleStatuses[]`, and assert a pure JS **mirror** of each SQL bucket predicate agrees with the bucket `deriveProjectStatus(...)` lands in (`confirmed`→active, `paused`/`cancelled`→other, else tentative). Also assert the three buckets **partition** every combination (exactly one true). Keep the JS mirror next to the SQL builder in `project-status-sql.ts` with a lockstep comment so the two are edited together.

### 3. Loader — `src/actions/projects/getProjectsList.ts` (new; replaces `getProjectsPage.ts`)

Share one row-assembly path; expose a non-paginated and a paginated entry point.

```ts
export type ProjectListItem = {
  id: string; name: string;
  status: ProjectRoleStatus;          // derived in JS (deriveProjectStatus)
  linesOfBusiness: LineOfBusiness[];  // derived in JS (deriveProjectLinesOfBusiness)
  companyId: string; companyName: string;
  deliveryManagerNames: string[]; roleCount: number;
  startDate: string | null;  // min role startDate "YYYY-MM-DD"; null when no roles
  endDate: string | null;    // max role endDate   "YYYY-MM-DD"; null when no roles
};
export type ProjectsListFilters = { query?: string; lineOfBusiness?: LineOfBusiness };

// All projects in the given buckets (no pagination) — for the Tentative/Active sections.
export function getProjectsInBuckets(
  buckets: ProjectStatusBucket[], filters?: ProjectsListFilters,
): Promise<ProjectListItem[]>;

// One page of projects in the given buckets — for the Other section and the flat filtered view.
export function getProjectsPage(
  page: number, buckets: ProjectStatusBucket[], filters?: ProjectsListFilters, pageSize?: number,
): Promise<Page<ProjectListItem>>;
```

- **`where` builder** combines: `derivedStatusCondition(buckets)`; `lineOfBusiness` → `exists(role with that lineOfBusiness)` (simple presence, no lockstep); `query` → `or(ilike(projects.name,%q%), ilike(companies.name,%q%))` (join `companies`, same as opportunities). Applied to **both** the `count()` and the row query.
- **Row assembly (shared internal `assembleRows`)** keeps today's no-N+1 shape: base rows (projects ⋈ companies, `orderBy(asc(projects.name))`), then one grouped delivery-manager query and one role query, both scoped `inArray(projectRoles.projectId, ids)`. From the role rows derive in JS: `status` (`deriveProjectStatus`), `linesOfBusiness` (`deriveProjectLinesOfBusiness`), `roleCount`, and `startDate`/`endDate` as string min/max (zero-padded `"YYYY-MM-DD"` `date()` columns ⇒ lexicographic == chronological; no roles ⇒ both `null`).

Note the split: **SQL decides bucket membership** (for pagination); **JS derives the displayed status** — the agreement test (§2) keeps them consistent.

### 4. Card — `src/components/projects/project-card.tsx` (new, presentational)

Model on `staff-card.tsx`. `Card` is a plain `<div>` that does **not** forward Base UI's `render`, so wrap it in `<Link href={`/projects/${id}`} aria-label={name} className="block">` and put `p-5 transition-colors hover:bg-accent` on the `Card`. Contents: name (`font-medium truncate`); company (`text-sm text-muted-foreground`); `<ProjectStatusBadge status={project.status} />`; LoBs as `flex flex-wrap gap-1` of `<Badge variant="outline">{LINE_OF_BUSINESS_LABELS[lob]}</Badge>` (muted "—" when empty); delivery managers (`deliveryManagerNames.join(", ")`, truncated; muted fallback when none); date range via `formatShortDate`+`parseIsoDate` from `src/lib/format/format.ts` as `"{start} – {end}"` (muted fallback when `startDate` null). Optionally add a `formatDateRange(start,end)` helper to `format.ts`.

### 5. Filter bar — `src/components/projects/projects-list-filters.tsx` (new, `"use client"`)

Near-copy of `opportunities-list-filters.tsx`, minus the stage select: debounced search `Input` (`useDebouncedValue`, 300ms) + `SelectFilter` over `LINE_OF_BUSINESS`/`LINE_OF_BUSINESS_LABELS`, each navigating via `router.replace(buildListHref("/projects", "projectsPage", params, { q | lob }))`. `buildListHref` drops `projectsPage`, so any filter change resets to page 1. "Clear filters" ghost button → `router.replace("/projects")`.

### 6. Section + grid — small presentational pieces (in `project-card.tsx`'s folder or inline in the page)

A `ProjectsGrid` (`grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4` of `ProjectCard`s) and a section wrapper rendering an `<h3>` + count above a grid, with a muted empty note. No client state — these are server components.

### 7. Page — `src/app/(app)/projects/page.tsx` (rewrite)

Reads `params`; `q = firstParam(params.q).trim()`, `lob = parseLineOfBusiness(params.lob)` (copy the validator from `opportunities/page.tsx`), `page = parsePage(params.projectsPage)`; `filtering = Boolean(q) || Boolean(lob)`. Keep header, `canEdit`, `<AddProjectDialog />`, and render `<ProjectsListFilters params={params} />` above the results.

- **`filtering`**: `const result = await getProjectsPage(page, ["tentative","active","other"], { query: q, lineOfBusiness: lob })` → one flat `<ProjectsGrid>` + `<PaginationControls basePath="/projects" paramKey="projectsPage" params={params} page={result.page} pageCount={result.pageCount} />`; empty → muted "No projects match these filters."
- **not `filtering`**: `Promise.all([getProjectsInBuckets(["tentative"]), getProjectsInBuckets(["active"]), getProjectsPage(page, ["other"])])` → three sections (Tentative, Active, Other); Other's grid followed by `<PaginationControls>` on `projectsPage`. Hide a section when empty.

### 8. Remove

`src/actions/projects/getProjectsPage.ts` (old signature) and `src/components/projects/projects-table.tsx` + its `ProjectRow` type. First confirm no other importers (the `ProjectRow` hit in `getCompanyDetail.ts` is a local variable, not this type).

### Reused unchanged

`deriveProjectStatus` / `deriveProjectLinesOfBusiness`, `ProjectStatusBadge`, `Badge` + `LINE_OF_BUSINESS`/`LINE_OF_BUSINESS_LABELS`, `Card`, `SelectFilter`/`FilterLabel`/`ALL`, `useDebouncedValue`, `buildListHref`/`firstParam`, `PaginationControls`, `parsePage`/`CRM_PAGE_SIZE`/`clampPage`, `formatShortDate`/`parseIsoDate`, `AddProjectDialog`, permissions wiring. **No schema/migration changes** — `project_roles.startDate`/`.endDate` already exist.

## Verification

- `bun run check` (Biome + `tsc --noEmit` + tests, incl. the **new** `project-derived.test.ts` bucket-agreement test) and `bun run build`.
- `bun run dev`, open `/projects`:
  - **No filters:** three sections in order (Tentative, Active, Other); Tentative & Active show all; **Other paginates** (Prev/Next in `PaginationControls`, correct page count, URL gets `?projectsPage=`); empty sections hidden.
  - **Filter:** typing a term matches both a project name and a client company name; picking a line of business collapses to one flat paginated grid; changing a filter resets to page 1 (`projectsPage` dropped from URL); "Clear filters" restores the three sections; state is shareable via URL / survives back-navigation.
  - **Card:** name, company, status badge, LoB badges, delivery managers (comma-joined; fallback when none), date range (`min → max`; fallback when project has no roles); whole card links to `/projects/{id}`.
  - **Bucket sanity:** a project with a tentative role appears under Tentative; all-confirmed under Active; a paused-only or all-cancelled project under Other — matching its status badge.
- After merge, dispatch the **librarian** subagent to reconcile `docs/domains/projects.md` (list view is now a filtered, status-grouped card grid; document the new derived-status SQL predicates + agreement test) and to fix the stale test references in `getCompaniesPage.ts` / `project-derived.ts` now that the test exists.
