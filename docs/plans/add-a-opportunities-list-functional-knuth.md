# Opportunities list view + capped board columns

## Context

`/opportunities` today is **kanban-only** (`OpportunityBoard` fed by
`getOpportunitiesBoard()`, which fetches the *entire* pipeline with no pagination).
Two problems this creates:

1. **No way to browse/search/filter opportunities as a flat list** the way
   `/companies`, `/contacts`, and `/projects` already offer table pages. There's no
   server-side search or filtering anywhere for opportunities.
2. **The high-volume columns don't scale.** The Maturing, Won, and Lost columns
   accumulate entries indefinitely; loading and rendering all of them bloats the
   board. Users rarely need every closed/maturing deal on the board — just the
   recent ones, with a way to dig deeper on demand.

**Outcome:** add a paginated, searchable, filterable **list view** on the same
`/opportunities` page (toggled via `?view=list`), and **cap** the three high-volume
board columns to their 20 most-recently-updated cards with a **"Show more"** button
that deep-links into the list view pre-filtered to that stage.

No schema/migration changes — this uses only existing columns (`status`,
`lineOfBusiness`, `updatedAt`, `createdAt`). No seed changes.

## Decisions (confirmed with user)

- **Placement:** one page, `?view=list` toggle (default = board). Not a separate route.
- **Stage filter granularity:** the **9 kanban groups** (`OPPORTUNITY_GROUPS`), not the 14 leaf statuses.
- **Column cap:** **20** cards per capped column.
- **"Most recent":** `updatedAt desc` (best proxy for recently-closed — there is no `closedAt`).

## Shared constants & helpers — `src/lib/crm/opportunity-pipeline.ts`

This pure, client-importable module already owns the pipeline groups. Add there so
the board, the board read, and the list read share one source of truth:

- `export const BOARD_COLUMN_CAP = 20;`
- `export const CAPPED_BOARD_STATUSES = ["maturing", "closed_won", "closed_lost"] as const;`
  (these map 1:1 to groups `maturing` / `won` / `lost` via the existing `groupOfStatus`).
- `export function opportunityGroupById(id: OpportunityGroupId): OpportunityGroup` — look up a group's `statuses` from a group id (used by the list-read filter and the toggle). Reuse the internal `GROUP_INDEX_BY_ID` map already computed at module load.

## 1. Board read — cap the high-volume columns (`src/actions/crm/getOpportunitiesBoard.ts`)

Change the return type from `OpportunityBoardCard[]` to an object that also carries
per-capped-status totals so the board knows which columns are truncated:

```ts
export type OpportunitiesBoardData = {
  cards: OpportunityBoardCard[];
  // Full count per capped status (present only for CAPPED_BOARD_STATUSES).
  // A column is truncated when its total exceeds the cards returned.
  cappedTotals: Partial<Record<OpportunityStatus, number>>;
};
```

Behavior:
- Rows in **non-capped** statuses: returned in full, as today (order `(position asc, createdAt asc)`).
- Rows in **capped** statuses: only the **20 most-recently-updated** (`updatedAt desc`) per status.
- Return the **full count** of each capped status in `cappedTotals`.

Implementation: build the base select as a subquery adding two window functions
partitioned by status —
`row_number() over (partition by status order by updated_at desc)` and
`count(*) over (partition by status)` (drizzle `sql``…`` )` — then keep rows where
`status NOT IN (CAPPED_BOARD_STATUSES) OR row_number <= BOARD_COLUMN_CAP`. Derive
`cappedTotals` from the `count(*)` window value on the surviving capped rows. The
company join, `latestNextStep` leftJoin, and the grouped owner-names query are
unchanged (still no N+1). The board client re-sorts each column by
`(position, createdAt)`, so returning the capped 20 out of update-order is fine —
`updatedAt` only selects *which* 20, position still orders them.

**Owner-name resolution** is duplicated between this read and the new list read —
extract it into a shared server-only helper (e.g.
`src/actions/crm/opportunityOwnerNames.ts`: `resolveOwnerNames(ids): Promise<Map<string,string[]>>`)
and call it from both.

## 2. New list read — `src/actions/crm/getOpportunitiesPage.ts` (server-only)

Mirror `getCompaniesPage.ts` (count → `clampPage` → `limit/offset`, returns
`Page<T>` from `src/lib/core/pagination.ts`, `CRM_PAGE_SIZE = 20`), but accept
filters — the first filtered/searchable paginated read in the app:

```ts
export type OpportunityRow = {
  id: string; name: string;
  companyId: string; companyName: string;
  status: OpportunityStatus;
  lineOfBusiness: LineOfBusiness;
  ownerNames: string[];
  updatedAt: number; // epoch ms
};

export type OpportunitiesPageFilters = {
  group?: OpportunityGroupId;    // stage filter
  lineOfBusiness?: LineOfBusiness;
  query?: string;                // name / company-name search
};

export async function getOpportunitiesPage(
  page = 1,
  filters: OpportunitiesPageFilters = {},
  pageSize = CRM_PAGE_SIZE,
): Promise<Page<OpportunityRow>>
```

- Compose a `where` with `and(...)` from present filters:
  - `group` → `inArray(opportunities.status, opportunityGroupById(group).statuses)`
  - `lineOfBusiness` → `eq(opportunities.lineOfBusiness, lob)`
  - `query` → `or(ilike(opportunities.name, %q%), ilike(companies.name, %q%))` (join `companies`, trim/guard empty).
- `count()` with the same `where`, then `clampPage`, then rows ordered
  **`updatedAt desc`** (most-recently-touched first), `limit/offset`.
- Reuse `resolveOwnerNames` for owner names.
- **Gate:** none beyond the authenticated `(app)` layout — parity with
  `getCompaniesPage`/`getOpportunitiesBoard` (CRM reads carry no capability gate today;
  do **not** invent one here).

## 3. Page — `src/app/(app)/opportunities/page.tsx`

Make it read `searchParams` (a `Promise` in this Next build — `await` it) and branch on `view`:

- Params: `view` (`"list"` → list, else board), `oppPage`, `stage` (group id), `lob`, `q`.
- **Board view (default):** fetch `getOpportunitiesBoard()`, pass `cards` + `cappedTotals` to `OpportunityBoard`.
- **List view:** fetch `getOpportunitiesPage(parsePage(params.oppPage), { group, lineOfBusiness, query })`.
- Header row keeps the `Pipeline` heading + `AddOpportunityDialog` (canEdit), and gains a **`<OpportunityViewToggle current={view} />`** (segmented Board/List links).

## 4. New UI components (`src/components/crm/`)

- **`opportunity-view-toggle.tsx`** — two `<Button render={<Link/>}>` (Base UI polymorphism, per ui rules) styled as a segmented control. "Board" → `/opportunities` (drops list params); "List" → `/opportunities?view=list`. Active state via `current`.
- **`opportunities-list-filters.tsx`** (`"use client"`) — the filter bar. `Input type="search"` (debounced ~300ms) for `q`, plus two `SelectFilter` (from `@/components/form/filters`, using the `ALL` sentinel): **Stage** (options = `OPPORTUNITY_GROUPS`, labels from group `label`) and **Line of business** (`LINE_OF_BUSINESS` + `LINE_OF_BUSINESS_LABELS` from `@/lib/crm/line-of-business`). On any change, rebuild `URLSearchParams`, set/delete the key, **reset `oppPage` to 1**, and `router.replace` (mirror the param-preserving `buildHref` in `pagination-controls.tsx`; `nuqs` is not installed, hand-roll with `useRouter`/`usePathname`/`useSearchParams`). Initialize control state from current params.
- **`opportunities-table.tsx`** (`"use client"`) — mirrors `companies-table.tsx` structure using `@/components/ui/table` primitives + `EmptyState`. Columns: **Name, Company, Stage** (`OpportunityStatusBadge`), **Line of business** (`Badge`), **Owner(s)**, **Last updated**. Rows are clickable and open the existing **`OpportunityDetailSheet`** via **`loadOpportunityDetail`** — reuse exactly the drawer pattern the board already uses (manage a `selectedId` in state, render one `OpportunityDetailSheet`). This gives the list full parity with the board's detail interaction without a new detail route (opportunities have no standalone detail page).

The list section renders: filters bar → `OpportunitiesTable rows` → `PaginationControls basePath="/opportunities" params={params} paramKey="oppPage" page pageCount` (it already preserves `view`/`stage`/`lob`/`q`).

## 5. Board — "Show more" + new props (`src/components/crm/opportunity-board.tsx`, `opportunity-board-column.tsx`)

- Accept the new `cappedTotals` prop alongside `cards`.
- Each column computes `shown = cards in column` and, for capped statuses, `total = cappedTotals[status]`. When `total > shown`, render a **"Show N more"** link at the column bottom → `/opportunities?view=list&stage=<groupId>` (`groupId` via `groupOfStatus(status).id` → `maturing`/`won`/`lost`).
- **Known limitation to note in code:** the board's existing *client-side* name search only filters the (now capped) loaded cards — it won't surface capped-out cards. That's acceptable: comprehensive search lives in the list view. Add a short comment; no behavior change to the board search itself.

## Critical files

| File | Change |
|---|---|
| `src/lib/crm/opportunity-pipeline.ts` | add `BOARD_COLUMN_CAP`, `CAPPED_BOARD_STATUSES`, `opportunityGroupById` |
| `src/actions/crm/getOpportunitiesBoard.ts` | cap 3 columns to 20 most-recent, return `{ cards, cappedTotals }` |
| `src/actions/crm/getOpportunitiesPage.ts` | **new** filtered/paginated list read |
| `src/actions/crm/opportunityOwnerNames.ts` | **new** shared owner-name resolver (DRY the two reads) |
| `src/app/(app)/opportunities/page.tsx` | read `searchParams`, branch board vs list |
| `src/components/crm/opportunity-view-toggle.tsx` | **new** Board/List toggle |
| `src/components/crm/opportunities-list-filters.tsx` | **new** URL-synced search + stage + LOB filters |
| `src/components/crm/opportunities-table.tsx` | **new** table + detail-sheet reuse |
| `src/components/crm/opportunity-board.tsx` / `opportunity-board-column.tsx` | accept `cappedTotals`, render "Show more" |

Reused as-is: `pagination.ts` (`Page`, `parsePage`, `clampPage`, `CRM_PAGE_SIZE`),
`PaginationControls`, `SelectFilter`/`ALL` (`form/filters`), `@/components/ui/table`,
`OpportunityStatusBadge`, `Badge`, `EmptyState`, `InternalLink`,
`OpportunityDetailSheet` + `loadOpportunityDetail`, `latestNextStep` helper.

## Conventions to honor

- **Next.js**: before editing the page/routing, skim `node_modules/next/dist/docs/` for the `searchParams`/`useSearchParams` APIs (this build has breaking changes; ui rule + nextjs rule).
- **Reads are `server-only` functions**, not `'use server'` actions (server-actions rule). All DB access stays in the actions layer — no `db` in components.
- **UI**: flat surfaces (hairline borders, no shadows on in-page surfaces), sharp 4px radius, Tabler icons, `IconButton` for icon-only buttons, `cn()` for conditional classes.
- **RBAC**: reads stay ungated to match existing CRM read parity; do not touch `permissions.ts`. If anything here appears to expose data across users, STOP and flag it.

## Verification

1. `bun run check` (Biome + `tsc` + tests) and `bun run build` — both green.
2. Run the app (`/run` or `bun run dev`) and verify against seeded data:
   - `/opportunities` → board. Maturing/Won/Lost show ≤20 cards; when the seed has >20 in one, a "Show N more" appears at the column bottom.
   - Clicking "Show more" → `?view=list&stage=…` with the stage filter pre-applied.
   - List view: table renders with pagination; **search** narrows by name/company; **Stage** and **Line of business** filters narrow results and combine; changing a filter resets to page 1 and preserves the others in the URL; a row opens the detail drawer.
   - Toggle switches Board ⇄ List; "Board" clears list params.
   - If the seed lacks >20 rows in a capped column, temporarily verify the cap by lowering `BOARD_COLUMN_CAP` locally (revert after) or note it.
3. After merge-ready, **dispatch the `librarian` subagent** to reconcile `/docs` (CRM/opportunities domain doc + any flows) with the new list view and board capping.
