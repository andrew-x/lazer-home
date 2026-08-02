# 0060 — The projects list as a sortable table with status tabs; nulls sort last; margin *order* is gated like margin *figures*

**Status:** accepted · 2026-08-02 · **supersedes
[ADR 0057](./0057-projects-list-margin-and-derived-flags.md) §7** (the card layout) and
resolves the "not built" margin-sort entry in its alternatives list · **keeps** ADR 0057 §3
(both currencies precomputed server-side), §6 (list-scoped FX note) and §8 (currency as client
context) untouched · **keeps** [ADR 0059](./0059-project-delivery-notes-and-list-health.md)'s
monochrome treatment of low health · **no matrix change**

## Context

ADR 0057 turned `/projects` into a grid of cards, each carrying a badge row of derived risk
flags over a definition list of six labelled fields — Status, Line of business, Delivery,
Dates, Health, Margin. That decision was right about *what* to show and wrong about *how*.

Three things made the result hard to read:

1. **Labels outweighed values.** Twenty cards × six `<dt>`s put ~120 repeated label words on
   screen to carry ~20 figures.
2. **Nothing aligned.** `CardField` set each label inline before its value, so every value
   began at a different x-position — ragged inside one card, and unalignable across the grid.
   Margin and health are *numbers*, and numbers that can't stack in a column can't be compared.
3. **The list couldn't be asked a question.** Order was server-chosen (`name`, or `endDate`
   for the filtered view) with no user control at all. "Which engagements are bleeding?" and
   "worst health first" were unanswerable.

Two structural problems compounded it. Status appeared on every card in a view *already
grouped by status*; and four of the five status sections rendered as closed disclosures, so
the page opened on Active with the rest of the portfolio one click away and invisible.

The list serves three jobs at once — compare the portfolio, triage risk, find one project.
All three want aligned, sortable columns.

## Decision

### 1. A table, not cards — and the badge column still means "look at this one"

`src/components/projects/projects-table.tsx` replaces `project-card.tsx` and
`projects-grid.tsx` (both deleted). Nine columns: **Project · Client · Risk · Line of business
· Delivery · Roles · Dates · Health · Margin**, with identity left, the one warning column
next, facts in the middle, and the two figures right-aligned and `tabular-nums` at the edge.

**What ADR 0057 §7 got right survives the layout change.** The Risk column carries *only*
derived flags and stays empty for an unflagged project — status is the tab above the table
now, and line of business is still plain text. A badge on every row would distinguish nothing;
reserving the column for exceptions is what keeps a red "Negative margin" visible down a page
of twenty. `PROJECT_FLAGS` is ordered worst-first, so the cell shows `flags[0]` plus a muted
`+N`, keeping rows a uniform height with the full list in the cell's `title`.

The empty-value wording rule is unchanged and load-bearing: **"No budget", "No roles", "Not
rated", "Unassigned", "No dates" — never a bare em dash.** A dash reads as a number we lost.

**Health gained a bar** (`health-bar.tsx`): ten monochrome segments beside the figure. The
point is the column, not the cell — twenty ratings read as twenty numbers you compare one at a
time, where twenty bars read as a shape you can sweep. Ten discrete segments because the scale
is a ten-point integer, not a percentage; plain `<div>`s rather than SVG per `docs/ui.md`'s
"check whether nesting and borders do the job first"; and **monochrome**, because ADR 0059
deliberately kept the "Low health" tag neutral rather than red and colouring the bar would
quietly reverse that. Losses in the Margin column remain the only coloured thing on the page.

**Accepted cost: the page is `max-w-7xl`, not the `max-w-5xl` every other list uses.** Nine
columns do not fit the standard shell, and the whole value of the table is that its figures
line up rather than wrap. The table scrolls horizontally inside `overflow-x-auto` below that.

### 2. The five status sections became tabs — and collapsed two code paths into one

`projects-status-tabs.tsx` renders Active (default) · Tentative · Paused · Past · Cancelled.
A tab strip costs the same click the old chevrons did and shows you what you're choosing
between.

They are **links in a `<nav>`, not a `Tabs` primitive**: switching buckets changes the server
query, so this is navigation, not client-side panel switching, and every tab stays a real URL
that shares, opens in a new tab, and works with the back button. The underline treatment
matches `Tabs variant="line"` so it reads as the same control. The default tab is a bare
`/projects`, so the page people land on carries no state in its URL.

**This deleted the page's biggest source of complexity.** The old
`filtering ? FilteredView : GroupedView` branch is gone, along with three independent page
params (`projectsPage`, `pastPage`, `cancelledPage` → one `page`) and `getProjectsInBuckets`
(every bucket now takes the same paginated read). The unpaginated Active/Tentative/Paused
sections are paginated for the first time.

**Tab counts are filter-aware, and that is what replaces cross-status search.** Searching
"Acme" from the Active tab shows "Cancelled 1" rather than silently hiding the match. Every
bucket always renders, including empty ones — the strip must not reshuffle as filters change,
and "Cancelled 0" is a fact worth stating. Costed as five concurrent `count()`s
(`getProjectBucketCounts`): the bucket predicates are correlated-`EXISTS` expressions over
`project_roles`, not a column that could be grouped by.

### 3. Sorting is server-side, and nulls sort **last in both directions**

The list is paginated, so a client-side sort would reorder twenty rows while presenting itself
as having ordered the list. `DataTable`'s TanStack sorting is therefore the wrong tool here;
the headers use `SortHeaderButton` (the plain-props binding) and navigate.

The null story is the thing ADR 0057 said had to be settled before a margin sort could exist:

> sorting by a figure half the roles can't be costed from would need a story for the nulls first

**Nulls sort last regardless of direction.** "No budget", "No roles" and "Not rated" mean
*unknown*, not *lowest* — a project nobody has priced is not the worst-margin project, and
burying it under a descending sort would be as wrong as floating it to the top of an ascending
one. This is not a new rule: it is exactly what `compareSortValues` already did for the
compensation-plan editor, which is why that function moved from
`src/components/form/sort-header.tsx` to **`src/lib/core/sort.ts`** — a boundary-free module
the `server-only` reads can import too. `sort-header.tsx` re-exports it, so its existing
callers were untouched. SQL sorts spell out `nulls last` in both directions, because Postgres
defaults to nulls-*first* under `desc`, which would open a descending health sort with every
unrated project.

Each column also has a **first-click direction** (`DEFAULT_SORT_DIRECTION`) rather than
always starting ascending: names read A–Z, dates latest-first, and health and margin
**worst-first**, because the reason anyone sorts by those is triage.

### 4. Margin has no SQL expression, so it takes a second execution path

`name` / `client` / `endDate` / `health` are `ORDER BY`s and paginate in SQL. `health` needed a
new correlated scalar subquery, `latestHealthRating` in `project-status-sql.ts`, whose
`order by` is **LOCKSTEP** with `latestDeliveryNoteFirst` — spelled out rather than imported
because that constant lives in the actions layer and this is `lib`. If the two ever drift, the
list will sort by one note and display another.

**Margin cannot join them.** It is computed in `assembleRows` from each role's hours and the
viewer's cost basis, so `getProjectsPageByMargin` assembles the whole filtered bucket, sorts,
and only then slices. Paginating first would produce a list whose ordering restarts every 20
rows. **Accepted cost:** this is the one order that costs more than a page of work. It is
opt-in by a header click, it is bounded by consultancy scale, and the buckets people actually
sort were already fetched unpaginated before this change. Revisit past ~500 projects in a
bucket — `assembleRows`' own comment already names itself as the multiplier.

**Margin sorts on `MARGIN_FLAG_CURRENCY` (CAD), always** — the currency the risk flags are
already evaluated in. The display currency is client state (ADR 0057 §8) and never reaches the
server, and both figures derive from the same native amounts through one rate set, so the
ranking holds whichever way the toggle is set.

### 5. The margin *ordering* is gated exactly like the margin *figures*

**This is the security-relevant part of this ADR.** A margin-ranked list discloses which
engagements are most and least profitable. That ranking is derived from individual
compensation just as the numbers are, so hiding the column while honouring `?sort=margin`
would leak the very thing `projects.viewMargin` exists to withhold.

The gate is read **once**, at the page, from `marginContext.costBasis` — the `null` that
`getProjectCostBasis` returns for a viewer without the capability (ADR 0053 §7), so the
decision still lives in exactly one place. That one boolean drives three things: the Margin
column and its `<th>` are **omitted, not blanked**; the currency toggle is hidden; and
`sort=margin` falls back to the default order, which makes a hand-typed URL inert.

The architecture is already safe underneath: with no cost basis, `assembleRows` never builds
`MarginRoleInput`s, every `margin` is `null`, and there is nothing to sort by. **The standing
instruction is not to "repair" that dead sort by costing roles purely to order them.** The
margin-derived flags (`negativeMargin`, `lowMargin`) continue to vanish for these viewers
through the same mechanism, and the Risk column inherits that unchanged.

## Consequences

- **Deleted:** `project-card.tsx`, `projects-grid.tsx` (`ProjectsGrid` + `ProjectsSection`),
  `getProjectsInBuckets`, and the grouped/filtered branch in `(app)/projects/page.tsx`.
- **New:** `projects-table.tsx`, `health-bar.tsx`, `projects-status-tabs.tsx`,
  `src/lib/projects/projects-list-sort.ts` (the list's URL vocabulary — sort keys, page/status
  param names, tab order, parsers), `src/lib/core/sort.ts`, `getProjectBucketCounts`,
  `getProjectsPageByMargin`, `latestHealthRating`, and `ProjectListItem.openRoleCount` (a
  `staffId === null` tally over role rows `assembleRows` already fetches — no new query).
- **Changed URL contract.** `projectsPage`/`pastPage`/`cancelledPage` → `page`; new `status`,
  `sort` and `dir`. Old links still resolve — unknown params are ignored and every parser
  falls back to a default — but they land on the default tab rather than their old section.
- **"Clear filters" no longer resets the view.** It clears `q`/`lob`/`dm` and keeps the tab and
  sort, because the tab you are on is not something you filtered by.
- **Search no longer spans all statuses in one view.** Mitigated by the filter-aware tab
  counts, which arguably surface cross-status matches better than the old flat list did.
- **Nine columns is a lot.** Line of business and Roles are the first two to fold into the
  Project cell as a muted second line if it reads cramped with real data.

## Alternatives considered

- **Keeping cards and restyling them.** Rejected: no card layout can align figures across
  a grid, and comparison was the primary complaint.
- **A `Tabs` primitive with client state.** Rejected — §2: the bucket decides the server query,
  so tabs that don't change the URL would break sharing, the back button, and reload.
- **Client-side sorting via `DataTable`.** Rejected — §3: it would sort the current page and
  read as having sorted the list.
- **Sorting margin in SQL.** Not possible — §4: margin has no expression, only a computation.
- **Sorting margin on the displayed currency.** Rejected — §4: the display currency is client
  state that never reaches the server, and one rate set makes the ranking stable anyway.
- **Dropping Line of business from the row** to buy back width. Considered and declined by the
  product owner; it is a column, and the `lob` filter still narrows by it.
- **A "needs attention" filter** narrowing to flagged projects. Not built — sorting by health
  or margin worst-first already answers it, and the Risk column is scannable. Cheap to add
  later: the flags are already computed server-side.
