# Profile completeness table (People management)

## Context

Staff profiles now carry a lot of self-service content — profile links, a résumé, skills,
a client intro, and two surveys (Manual of Me, Ways of Working). Every one of those is
optional and edited on a person's own profile, so **nobody can see, across the company,
who has actually filled them in.** Today the only way to answer "who still needs to add a
client intro?" is to open 100 profiles one at a time.

This adds a read-only **Profile completeness** table under People management: one row per
staff member, one column per profile artefact, filterable by name / line of business /
role / employment type and sortable on every column — so "sort by Client intro ascending"
immediately lists the people to chase.

Decisions taken with the user:

- **Cells show counts and dates, not bare ticks** — `2/3` links, a skill count, `14/30`
  Ways of Working. A half-finished 30-question survey must not look identical to a
  finished one.
- **Manual of Me gets a column too** — it is the sibling survey, stored the same way, and
  free once the read touches `responses`.
- **Managers + admins only**, via the existing `staff.edit` capability. **The RBAC matrix
  is unchanged** — no new capability, no new role row.

### One schema change is unavoidable

The user asked for "when their skills … was last updated". `clientIntroUpdatedAt` already
exists (and is currently written but never read anywhere). **There is no
`skillsUpdatedAt` column** — `updateStaffSkills` writes only the `skills` jsonb. So this
plan adds it, mirroring the `resumeUpdatedAt` pattern exactly.

Consequence to accept: **it starts NULL for everyone** and only fills in as people edit
their skills from here on. There is no honest backfill — `staff.updatedAt` is `$onUpdate`
and gets bumped by a Rippling CSV re-sync, which is precisely why `resumeUpdatedAt` and
`clientIntroUpdatedAt` are stamped explicitly rather than derived (`staff-schema.ts:119-124`).
The column renders `—` until the person next saves their skills.

## The table

Route `/people/profile-completeness`, nav label **Profile completeness**.

| Column | Source | Cell | Sort |
|---|---|---|---|
| Person | `staff.name` | name, linking to `/staff/[id]` | asc (default) |
| Line of business | latest `staff_employment` | `LINE_OF_BUSINESS_LABELS` | label |
| Role | latest `staff_employment` | `ROLE_LABELS` | label |
| Type | latest `staff_employment` | `EMPLOYMENT_TYPE_LABELS` (Full time / Hourly) | label |
| Links | `linkedinUrl` / `githubUrl` / `portfolioUrl` | `2/3`, `—` at 0 | count |
| Résumé | `staff.resume` | `✓` / `—` | boolean |
| Skills | `staff.skills` | count, `—` at 0 | count |
| Skills updated | **new** `staff.skillsUpdatedAt` | `formatTimestamp`, `—` | date, nulls last |
| Client intro | `staff.clientIntro` | `✓` / `—` | boolean |
| Intro updated | `staff.clientIntroUpdatedAt` | `formatTimestamp`, `—` | date, nulls last |
| Manual of Me | `responses` ∩ `MANUAL_OF_ME_QUESTION_IDS` | `4/7`, `—` at 0 | count |
| Ways of working | `responses` ∩ `WAYS_OF_WORKING_QUESTION_IDS` | `14/30`, `—` at 0 | count |

Filters (in-memory, local `useState` — matching every other staff table; **no URL state**,
consistent with `staff-directory.tsx` and `bulk-edit-roles.tsx`): name search, line of
business, role, employment type, plus a **Show inactive** toggle defaulting off. A
`hasFilters`-gated "Clear filters" ghost button and a "Showing N of M" line, as in
`plan-toolbar.tsx`.

Sorting is client-side. Default first-click direction (ascending) is already the useful
one for every completeness column — 0 first is exactly "who has not filled it out" — so no
`DESC_FIRST` set is needed.

## Work

### 1. Schema + write path — `skillsUpdatedAt`

- `src/lib/db/staff-schema.ts` — add `skillsUpdatedAt: timestamp()` immediately after
  `skills`, carrying the same comment rationale as `resumeUpdatedAt` (stamped explicitly,
  deliberately **not** `$onUpdate`, so an import re-sync can't falsely bump it).
- `bun run db:generate` → `bun run db:migrate`.
- `src/actions/staff/updateStaffSkills.ts` — `.set({ skills, skillsUpdatedAt: new Date() })`.
  Unconditional stamp on save, matching `updateStaffResume.ts:26-29` and
  `updateStaffClientIntro.ts:28-31` (neither compares old vs new).
- `scripts/seed/staff.ts` — set `skillsUpdatedAt` alongside `skills` at **both** insert
  sites (~L139 and ~L306). The seed imports the real Drizzle tables, so a stale seed fails
  `bun run check`.

### 2. Shared answered-response predicate

Two conflicting definitions of "answered" exist today:
`getWaysOfWorking.ts:27-31` (`textResponse !== null || listResponse non-empty`) and
`profile-view.tsx:142-144` (`textResponse !== null` only). The new read needs the same
notion for both surveys, so extract one:

- New pure module `src/lib/staff/survey-answers.ts` exporting
  `isResponseAnswered({ textResponse, listResponse })` — the WOW definition, which is a
  correct superset for the text-only Manual of Me.
- Have `getWaysOfWorking.ts` import it instead of its private copy. (Leave
  `profile-view.tsx` alone unless it falls out naturally — it consumes a different shape.)

### 3. The read — `src/actions/staff/getProfileCompleteness.ts`

`import "server-only"`, plain async function (**not** a `'use server'` action), exported
row type — per `.claude/rules/server-actions.md`. Gate it defensively with
`requirePermission(user ?? { role: null }, { staff: ["edit"] })`, following
`src/actions/staff/getBonusPayments.ts`.

Three queries, no N+1 — the shape is `getStaffDirectory.ts` plus a responses roll-up:

1. **`staff`**, ordered by name. **Project presence, never content.** `resume` and
   `clientIntro` are free text a manager has no need to receive here, so compute booleans
   in SQL rather than shipping the strings and testing them in JS:
   ```ts
   const filled = (col: AnyPgColumn) =>
     sql<boolean>`(${col} is not null and btrim(${col}) <> '')`;
   // linkCount: sum the three `filled(...)::int`
   // skillCount: sql<number>`jsonb_array_length(${staff.skills})`  (notNull default [])
   ```
   Plus `id`, `name`, `isActive`, `skillsUpdatedAt`, `clientIntroUpdatedAt`.
2. **`staff_employment`** — reuse the shared `latestEmploymentFirst` ordering fragment
   (`src/lib/staff/staff-employment.ts`) + `firstPerKey` (`src/lib/core/collections.ts`),
   exactly as `getStaffDirectory.ts:79-91`. Never re-derive the effective-dating order.
3. **`responses`** where `questionId` is in the union of the two id tuples; group by
   `staffId` in JS using `isResponseAnswered`. Add a comment noting this scans that slice
   of the table (≈ staff × 37 rows — trivial at company scale), mirroring the existing
   note on `getStaffDirectory`'s full `staff_employment` scan.

Return inactive staff too, so the toggle is a UI concern (same as the directory).

### 4. Sorting on the shared read-only table

`src/components/admin/data-table.tsx` (`DataTable`) is TanStack but `getCoreRowModel` only
— no sorting. The TanStack `SortHeader` binding already exists
(`src/components/admin/table-filters.tsx`) and is used by three tables.

- **Move** `data-table.tsx` to a neutral `src/components/data-table.tsx` and re-export from
  the old path. This is the repo's own established precedent: `admin/table-filters.tsx`
  already re-exports the filter controls that moved to `components/form/filters.tsx` "so
  the admin tables keep their existing import site" once a non-admin consumer appeared.
- Add **optional** sorting — `getSortedRowModel()` + internal `SortingState` seeded from a
  `defaultSorting` prop — and an optional table `className` so the new page can apply
  `ROOMY_TABLE` (`src/components/table-density.ts`). Both optional, so the three existing
  `DataTable` call sites are untouched.
- Use `sortUndefined: "last"` on the date columns to match the repo's nulls-sort-last rule
  (`compareSortValues`, `src/components/form/sort-header.tsx:59-73`).

If the move proves noisy, the fallback is to import `DataTable` from `admin/` directly —
`edit-levels.tsx` already imports `SortHeader` from there — but the move matches precedent.

### 5. Page + client component

- `src/app/(app)/people/profile-completeness/page.tsx` — modelled on
  `src/app/(app)/people/levels/page.tsx`: `export const metadata`, `getCurrentUser()` +
  `userHasPermission(user, { staff: ["edit"] })` → `notFound()` (404, never an error, so
  the route can't be probed), `await getProfileCompleteness()`, render heading + muted
  description + the client table. Widen the container past `max-w-5xl` — 12 columns need
  the room; the table's own container handles horizontal scroll.
- `src/components/staff/profile-completeness-table.tsx` (`"use client"`) — filter row +
  `DataTable`. Controls come from `@/components/form/filters` (`SelectFilter`,
  `FilterLabel`, `ALL`), option lists from `STAFF_FILTER_OPTIONS`
  (`src/lib/staff/staff-filters.ts`), labels from `ROLE_LABELS` /
  `EMPLOYMENT_TYPE_LABELS` (`src/lib/staff/staff-enums.ts`) and `LINE_OF_BUSINESS_LABELS`
  (`src/lib/crm/line-of-business.ts`). One `useMemo` filter predicate with early returns,
  copying `bulk-edit-roles.tsx`. Empty cells use `<EmptyCell />`
  (`src/components/empty-cell.tsx`) — the repo has **no** tick-vs-dash convention today, so
  define the `✓`/`—` cell once as a small local component and reuse it for both boolean
  columns rather than inlining it per column.

### 6. Nav

`src/components/app-shell/nav.ts` — add to the People management `children`:
```ts
{ title: "Profile completeness", href: "/people/profile-completeness",
  permission: { staff: ["edit"] } },
```
`staff.edit` and `ratings.edit` have identical role rows, so the parent's existing
`{ ratings: ["edit"] }` gate still equals the union of its children — **update the comment
above `children` that asserts this**, so the claim stays checkable.

`src/app/(app)/people/page.tsx` — append a fourth branch to the redirect ladder. Put it
**last** so nobody's current landing page changes.

### 7. Seed data (so the feature is verifiable locally)

`scripts/seed/wipe.ts` clears `responses`, but **no seed file ever writes it** — so both
survey columns would read `0/7` and `0/30` for every row in a fresh seed, and the feature
can't be eyeballed. Add a small responses seed (a `scripts/seed/responses.ts` wired into
the existing seed entry point) giving a random subset of staff a partial spread of
answers across both surveys. Vary `skillsUpdatedAt` / `clientIntroUpdatedAt` too, so the
date sorts have something to sort.

### 8. Docs

Dispatch the **librarian** subagent afterwards with a summary of: the new
`skillsUpdatedAt` column, the new read and route, the nav change, and the `DataTable`
relocation. Two stale facts to fix in passing: `docs/domains/staff-profiles.md` says Ways
of Working has **28** questions (the code has **30**), and states
`clientIntroUpdatedAt` is unread — this feature is its first reader.

## Verification

1. `bun run db:generate` && `bun run db:migrate` — confirm the generated SQL is a single
   `ALTER TABLE staff ADD COLUMN skills_updated_at timestamp;` and nothing destructive.
2. `bun run db:seed` — must complete; confirms the seed matches the new schema.
3. `bun run check` (Biome + `tsc --noEmit` + `bun test`, incl. the RBAC matrix test) and
   `bun run build`.
4. `bun run dev`, then as a **manager/admin**:
   - `/people/profile-completeness` renders; "Profile completeness" appears in the People
     management submenu.
   - Each of the 12 columns sorts both ways; nulls/zeros land **last** on descending and
     **first** on ascending (that ascending click is the "who hasn't done it" view).
   - Each filter narrows correctly and combines; "Showing N of M" tracks; Clear resets.
   - Show inactive off by default; toggling reveals terminated staff.
   - Edit your own skills at `/staff/[id]/skills`, return — **Skills updated** now shows
     today. Same for client intro via the profile dialog.
   - Answer one Ways of Working question — the count moves from `0/30` to `1/30`.
5. As a **non-manager** (a plain `staff` role): the nav entry is absent and navigating
   directly to `/people/profile-completeness` **404s**. Then confirm the read itself
   refuses independently of the route gate — the page gate alone is not the boundary.
6. `/audit-rbac` and `/code-review` before merging; confirm the RBAC matrix is genuinely
   untouched (`permissions.ts`, `permissions.test.ts`, `docs/domains/permissions.md` all
   unchanged).
