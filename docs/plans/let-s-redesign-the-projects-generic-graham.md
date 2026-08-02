# Redesign the `/projects` list

## Context

The projects list is currently a responsive grid of `ProjectCard`s
(`src/components/projects/project-card.tsx`), each rendering six labelled `<dl>` rows —
Status, Line of business, Delivery, Dates, Health, Margin. It's hard to parse, for four
specific reasons:

1. **Labels outweigh values.** ~20 cards × 6 labels = ~120 repeated label words competing
   with the ~20 figures you came for.
2. **Nothing aligns.** `CardField` puts the label inline before the value, so every value
   starts at a different x-position — ragged within a card and unalignable across cards.
   Margin and health are *numbers*, and numbers you can't stack in a column can't be compared.
3. **No hierarchy.** "Line of business" renders at the same size, weight and colour as
   "Margin". Everything is `text-sm`.
4. **You can't ask the list a question.** There is no user-facing sorting at all — order is
   server-chosen (`name` or `endDate`). "Which projects are bleeding?" is unanswerable.

Plus two structural problems: status appears on every card in a view that is *already*
grouped by status, and four of the five status sections start collapsed, so you land on
Active and everything else is behind a chevron.

The list serves three jobs at once — **compare the portfolio**, **triage risk**, and
**find one project**. All three want aligned, sortable columns. This plan replaces the
card grid with a dense sortable table and turns the five status buckets into tabs.

### Prior decisions this supersedes

[ADR 0057](../decisions/0057-projects-list-margin-and-derived-flags.md) §7 deliberately
deleted the old `projects-table.tsx` and moved status/LoB from badges into card fields, and
its alternatives list records that a sortable margin column was **"not built"** because
"sorting by a figure half the roles can't be costed from would need a story for the nulls
first." That null story is settled here (§ Sorting). This change therefore needs a **new ADR
(0060)** that supersedes 0057 §7 and updates the `/projects` section of `docs/ui.md`.

What ADR 0057 got right and this plan **keeps**: the badge row means "look at this one" —
only derived risk flags get badges. Status becomes the tab, not a badge; line of business
stays plain text.

---

## The new layout

One project per row. Identity on the left, the one warning column next, facts in the middle,
figures right-aligned at the right edge.

```
 Active (12)   Tentative (3)   Paused (1)   Past (48)   Cancelled (6)
 ──────────────                                                                    (tab strip)

 [ search…    ] [ Line of business ▾ ] [ Delivery manager ▾ ]              [ CAD | USD ]

 PROJECT ⇅              CLIENT ⇅      RISK             LOB     DELIVERY   ROLES    DATES ⇅          HEALTH ⇅      MARGIN ⇅
 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 Acme Platform Rebuild  Acme Corp     Neg. margin +1   Core    S. Rivera  4 · 1 open  Aug 3 – Dec 12   ███░░░░░░░ 3   –$12,400
                                                                                                       Jul 28           –8.1%
 Northwind Data Mesh    Northwind     Ending soon      Fintech P. Nair    6           Jun 1 – Aug 14   ██████░░░░ 6    $48,200
                                                                                                       Jul 30           22.4%
 Helios Design System   Helios Inc                     Design  J. Okafor  3           Sep 1 – Nov 30   ████████░░ 8    $31,050
                                                                                                       Jul 12           28.9%
 Vantage Migration      Vantage Ltd                    —       Unassigned 0           No dates         Not rated     No budget
 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
                                                                                    ‹ Prev   Page 1 of 3   Next ›
```

Rows are one logical row but the two numeric cells stack value-over-detail (health over its
note date; margin over its percentage), so a row is ~2 text lines tall. Cells use
`align-top`. Losses (`marginAmountTone`) remain the only coloured thing on the page.

### Column spec

| # | Column | Content | Alignment | Sortable |
|---|---|---|---|---|
| 1 | **Project** | `InternalLink` to `/projects/[id]`, `font-medium` | left | ✅ `name` (default) |
| 2 | **Client** | `InternalLink` to `/companies/[companyId]`, muted | left | ✅ `client` |
| 3 | **Risk** | Highest-severity flag `Badge` + muted `+N`; full list in a `Tooltip`. Empty cell when no flags. | left | — |
| 4 | **Line of business** | Comma-joined `LINE_OF_BUSINESS_LABELS`, truncating; muted "None" when role-less | left | — |
| 5 | **Delivery** | First DM name + muted `+N`, full list in a `Tooltip`; muted "Unassigned" | left | — |
| 6 | **Roles** | `{roleCount}` , plus muted `· N open` when any role has `staffId === null`; muted "None" at zero | right, `tabular-nums` | — |
| 7 | **Dates** | `formatDateRange(startDate, endDate)`; muted "No dates" | left, `tabular-nums` | ✅ `endDate` |
| 8 | **Health** | `HealthBar` + integer; `formatShortDate(noteDate)` muted beneath. Muted "Not rated" when null. | right | ✅ `health` |
| 9 | **Margin** | `money(margin)` with `marginAmountTone`; `formatPercent` muted beneath. "No budget" / "No roles" in words. **Whole column omitted (header included) when `margin === null`.** | right, `tabular-nums` | ✅ `margin` |

Nine columns will not fit `max-w-5xl` (1024px). **Widen this page's shell to `max-w-7xl`**
and wrap the table in `overflow-x-auto` (the same wrapper `src/components/data-table.tsx`
uses). This deliberately diverges from the `max-w-5xl` of the other list pages, because this
table carries more columns than any of them; note it in the ADR. On narrow viewports the
table scrolls horizontally rather than reflowing.

Everything the flags column shows is already computed — `PROJECT_FLAGS` in
`src/lib/projects/project-flags.ts` is ordered **worst-first**, so "highest severity" is just
`flags[0]`.

### Status tabs replace the collapsed sections

A URL-backed tab strip over `PROJECT_STATUS_BUCKETS`, reordered so the default leads:
**Active** (default) · Tentative · Paused · Past · Cancelled. Each tab carries a count that
**respects the active filters**, so searching "Acme" while on Active still reveals
"Cancelled (1)" — which is how cross-status discovery survives losing the flat filtered view.

Tabs must be links (they change server data), so use the `Tabs` primitive's `variant="line"`
styling with `render={<Link href={buildListHref(...)} />}` on each trigger. If Base UI's
`Tabs.Tab` misbehaves under `render`, fall back to a hand-rolled `<nav>` of links carrying the
same underline classes — cheap either way.

**This collapses the biggest source of complexity on the page.** The `filtering ? FilteredView
: GroupedView` branch in `src/app/(app)/projects/page.tsx` goes away, along with the three
independent page params (`pastPage`, `cancelledPage`, `projectsPage` → one `page`). One code
path: `getProjectsPage(page, [selectedBucket], filters, sort)`.

---

## Sorting

Sorting is **server-side and URL-backed** (`?sort=health&dir=desc`). This is not optional:
the list is paginated, so `DataTable`'s TanStack client sort would only sort the current page —
a lie. Reuse `SortHeaderButton` (`src/components/form/sort-header.tsx`, the plain-props variant
built for non-TanStack tables) with each header rendering a link built by `buildListHref`.

**The null story (ADR 0057's blocker).** Nulls sort **last in both directions**. "No budget",
"No roles" and "Not rated" mean *unknown*, not *lowest* — a project nobody has priced is not
the worst-margin project. SQL sorts get `nulls last` explicitly in both directions; the
in-memory sort partitions nulls to the tail before ordering the rest. Do **not** use TanStack's
`sortUndefined` (`docs/ui.md:33` already warns about it for a related case).

**Two execution paths**, because margin is not a SQL column:

- **`name` / `client` / `endDate` / `health`** — SQL `ORDER BY`, pagination stays in SQL exactly
  as today. `name` and `endDate` already exist in `orderClauses`. `client` is
  `companies.name`. `health` needs a new correlated scalar subquery — add
  **`latestHealthRating`** to `src/lib/projects/project-status-sql.ts` beside the existing
  `latestRoleEndDate`, ordered by the shared `latestDeliveryNoteFirst` clause so it can never
  disagree with the figure `assembleRows` displays.
- **`margin`** — assemble the whole filtered bucket, sort in JS on
  `margin[MARGIN_FLAG_CURRENCY]`, then slice the page. There is no SQL alternative: margin is
  computed in `assembleRows` from roles + cost basis. This path is opt-in by the user's own
  click, and Tentative/Paused/Active are *already* fetched unpaginated today
  (`getProjectsInBuckets`), so it is not a regression for the buckets people actually sort.

**Margin sorts on CAD, always** — matching `MARGIN_FLAG_CURRENCY`, which the risk flags already
use as their canonical comparison currency. The server cannot see the client-side currency
context (ADR 0057 §8), and both figures derive from the same native amounts through a single
rate set, so the ranking is stable across the toggle. State this in the ADR.

---

## Permissions — read this before touching the margin column

`projects.viewMargin` is the only gate on this surface, and the existing architecture is safe
by construction. Two rules:

1. **Omit, don't blank.** When `margin === null` the whole column disappears — `<th>` included.
   Do not render an empty cell. This is the existing card behaviour and must survive.
2. **`?sort=margin` must silently fall back to `name` for a viewer without the capability.**
   A margin-*ordered* list leaks the profitability ranking of every project even with the
   figures hidden, and margin is derived from individual compensation. This already happens
   for free: `getProjectCostBasis` returns `null` → `costBasis` is null → `assembleRows` never
   builds `MarginRoleInput`s → there is nothing to sort by. **Do not "fix" the dead sort by
   computing margin purely for ordering.** Guard it explicitly at the sort-param parse:
   ignore `sort=margin` unless the read produced a cost basis.

The margin-derived flags (`negativeMargin`, `lowMargin`) already vanish for these viewers via
the same mechanism — the Risk column inherits that unchanged.

---

## Files

**New**

- `src/components/projects/projects-table.tsx` — the table. Client component (reads
  `useProjectsCurrency`). Uses the `Table` primitives directly with `ROOMY_TABLE`
  (`src/components/table-density.ts`) — *not* `src/components/data-table.tsx`, whose sorting is
  client-side. Houses the `HealthCell` / `MarginCell` / `RiskCell` / `DeliveryCell` locals,
  ported from `project-card.tsx`'s `HealthValue` and `MarginValue` (keep their empty-state
  wording verbatim — "No budget", "No roles", "Not rated", "Unassigned", "No dates").
- `src/components/projects/health-bar.tsx` — `HealthBar`: ten `<div>` segments,
  `bg-foreground` filled / `bg-muted` empty, `gap-px`, ~4px × 8px each. Monochrome, matching
  ADR 0059's decision to keep low health *neutral* rather than red. No SVG and no chart
  dependency (`docs/ui.md:120`); per `docs/ui.md`, check nesting+borders before reaching for
  SVG — this is that case. `aria-hidden`, with the accessible value carried by the adjacent
  number.
- `src/components/projects/projects-status-tabs.tsx` — the link-based tab strip + counts.
- `docs/decisions/0060-projects-list-as-a-sortable-table.md` — supersedes ADR 0057 §7.

**Modified**

- `src/app/(app)/projects/page.tsx` — `max-w-5xl` → `max-w-7xl`; delete `GroupedView` and
  `FilteredView`; parse `status` / `sort` / `dir` / `page`; one `getProjectsPage` call; render
  tabs → filters → table → `PaginationControls`. Use `EmptyState`
  (`src/components/empty-state.tsx`) for the zero-row case instead of the bare `<p>`.
- `src/actions/projects/getProjectsList.ts` — widen `ProjectsListOrder` to
  `"name" | "client" | "endDate" | "health" | "margin"` plus a direction; extend
  `orderClauses`; add the margin branch (assemble-all → sort → slice) to `getProjectsPage`; add
  **`getProjectBucketCounts(filters)`** returning a `Record<ProjectStatusBucket, number>` (five
  `count()` queries under `Promise.all`, each reusing `projectsWhere([bucket], filters)`). Add
  **`openRoleCount`** to `ProjectListItem` — the role rows are already fetched in
  `assembleRows`, so it is a `staffId === null` tally, no new query.
- `src/lib/projects/project-status-sql.ts` — add `latestHealthRating`.
- `src/components/projects/projects-list-filters.tsx` — preserve `status`/`sort`/`dir` when
  filters change; "Clear filters" should clear the filters, not the tab.

**Deleted**

- `src/components/projects/project-card.tsx`
- `src/components/projects/projects-grid.tsx` (both `ProjectsGrid` and `ProjectsSection`)

**Unchanged** — `projects-currency.tsx` (toggle keeps working exactly as-is),
`project-flags.ts`, `project-health.ts`, `add-project-dialog.tsx`, `pagination-controls.tsx`.

---

## Verification

1. `bun run check` (Biome + `tsc --noEmit` + `bun test`) and `bun run build`.
2. `bun run dev` → `/projects` as a **`viewMargin` holder** (admin/manager/finance/delivery-manager):
   - Each tab loads, counts match the row totals, Active is the default with no `status` param.
   - Click every sortable header both directions. Confirm **"Not rated" / "No budget" / "No roles"
     rows sit at the bottom in *both* directions**.
   - Sort by margin, page forward, confirm ordering is continuous across the page boundary
     (this is the assemble-all path — if it paginated before sorting, page 2 would restart).
   - Toggle CAD/USD: figures change, **row order does not**.
   - Apply a search + LoB filter; confirm the tab counts shrink and other tabs still reveal matches.
3. Reload as a viewer **without `viewMargin`** (`sales` or `user`):
   - The Margin column and its header are **absent**, not blank.
   - `negativeMargin` / `lowMargin` badges never appear; `lowHealth` and `endingSoon` still do.
   - Hand-edit the URL to `?sort=margin&dir=asc` → falls back to name order, no error, no
     inferred ranking.
4. Narrow the window to phone width: the table scrolls horizontally, the page body does not.
5. Run `/code-review` and `/security-review` on the diff before merging.
6. Dispatch the **`librarian`** subagent to reconcile `docs/ui.md` (`/projects` section),
   `docs/domains/projects.md` (UI + "Margin & flags on the list") and the new ADR 0060.

---

## Accepted costs

- **Margin sort assembles the whole bucket.** Bounded by consultancy scale (hundreds of
  projects). `assembleRows`' own comment already names this as "the multiplier anything added
  here inherits" — revisit if a bucket passes ~500 projects.
- **Search no longer spans all statuses in one view.** Mitigated by filter-aware tab counts,
  which arguably make cross-status matches *more* visible than the old flat list did.
- **Nine columns is a lot.** If it reads cramped in practice, Line of business and Roles are
  the first two to fold into the Project cell as a muted second line — both were explicitly
  requested, so ship them as columns first and judge with real data.
