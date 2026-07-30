# Org chart on the staff page

## Context

`/staff` today is a flat card grid. The reporting structure exists in the data —
`staff.managerId` is a nullable self-referencing FK (ADR 0026), populated by the staff
CSV import — but nothing in the app renders it beyond a single "Reports to" link on a
profile. There is no way to see who reports to whom across the company.

This adds a **read-only org chart view** to `/staff`: people as nodes, reporting lines as
edges, filterable by line of business and role.

**No migration.** The edge already exists and the seed generates a real hierarchy
(4 roots → 8 managers → 30 ICs = 42 people, 3 levels deep).

**No new dependencies.** Confirmed with the user: the chart renders as a **DOM tree**
(nested `<ul>`/`<li>`, person cards, CSS-drawn connector lines), not an SVG canvas and not
a graph library. This respects `docs/ui.md`'s standing rule ("do not add a charting
dependency") and, more importantly, is the layout that actually survives the scale
constraint the user raised: a manager with 50 direct reports must not produce a 5,000px
wide row. Indented top-down means 50 reports is one narrow, scrollable column.

### Decisions taken with the user

| Decision | Choice |
|---|---|
| Rendering | DOM + CSS connector lines. No SVG, no library. |
| Placement | `?view=org` toggle on `/staff`, mirroring the opportunities Board/List toggle |
| Filtering | **Prune to matches + their ancestor chain.** Non-matching ancestors stay, faded ("pass-through"); non-matching non-ancestors are removed |
| Wide fan-out | Vertical stacking (inherent to the indented layout) + per-manager collapse with a `+N` badge |
| Filter state | Client-side `useState` (the `staff-directory.tsx` pattern). Only `?view=` is URL-backed |

---

## The one correction worth making up front

**"Show inactive" must be a prune predicate, not a pre-filter.** If inactive people are
filtered out of the input before the forest is built, an inactive manager becomes a
missing parent and her entire subtree detaches and shoots to the top level. Build the
forest from **all** entries, always, and route *every* filter — LoB, role, search, and
`isActive` — through the prune. An inactive manager then renders as a faded pass-through
node with her reports still attached, which is exactly the behaviour the chosen filter
semantics already give us, for free.

---

## Files

| Path | Status | Responsibility |
|---|---|---|
| `src/lib/staff/org-chart.ts` | **new** (pure) | Forest builder (cycle/self/orphan-safe), prune, matcher, collapse helpers |
| `src/lib/staff/org-chart.test.ts` | **new** | `bun test` — the correctness surface |
| `src/components/staff/org-chart.tsx` | **new** (`"use client"`) | Toolbar, filter + collapse state, prune wiring, drawer host |
| `src/components/staff/org-chart-node.tsx` | **new** (`"use client"`) | Recursive `<li>`: connectors, disclosure, person card |
| `src/components/staff/staff-view-toggle.tsx` | **new** (server) | Directory / Org chart segmented link toggle |
| `src/actions/staff/getStaffDirectory.ts` | **modify** | Add `managerId` to the projection + `StaffDirectoryEntry` (~3 lines) |
| `src/app/(app)/staff/page.tsx` | **modify** | Accept `searchParams`, branch on `?view=`, render the toggle |
| `docs/domains/staff-profiles.md` | **modify** | Document the view (delegate to `librarian`) |
| `docs/decisions/0054-staff-org-chart-dom-tree.md` | **new** | ADR — next number is **0054** (take it from `docs/decisions/README.md`, not `ls`) |

---

## 1. Server read — extend `getStaffDirectory`, don't add `getOrgChart.ts`

Verified: `getStaffDirectory()` has **exactly one caller** (`src/app/(app)/staff/page.tsx`).
`admin/bulk-edit-roles/page.tsx` imports only the `staffDirectoryFilterOptions` alias. So
there is no ripple risk and no second-reader benefit — the `?view=` toggle is a link, so
each request renders one view.

The chart's needs are a strict subset of `StaffDirectoryEntry` plus one column. A separate
read would be a ~40-line near-copy of the same two-query + `latestEmploymentFirst` +
`firstPerKey` shape — and the second copy is where the effective-dating rule drifts. One
entry type also structurally guarantees "line of business = Fintech" selects the same
people in both views.

```ts
// StaffDirectoryEntry
  /**
   * Who this person reports to (`staff.managerId`), or null at the top of the org.
   * Import-only and unguarded against cycles (ADR 0026) — the org-chart view's tree
   * builder does its own self/cycle/orphan guarding.
   */
  managerId: string | null;
```

Plus `managerId: staff.managerId` in the select projection and `managerId: s.managerId` in
the `.map()`. That is the entire server change.

---

## 2. `src/lib/staff/org-chart.ts` — the pure module

Header comment must mark it *a pure, client-importable module (no `db`/drizzle, no
`server-only`)*. It imports only the pure enum types, **not** `StaffDirectoryEntry` — so
tests build fixtures without inventing `skills`/`location`/`isBillable`. `StaffDirectoryEntry`
satisfies `OrgChartEntry` structurally once `managerId` lands (and `tsc` failing on that
assignability is the signal the two have drifted).

```ts
export type OrgChartEntry = {
  id: string; name: string; email: string; imageUrl: string | null;
  isActive: boolean;
  lineOfBusiness: LineOfBusiness | null;
  role: Role | null;
  managerId: string | null;
};

/** Why a node sits at the top of the forest — three of the four are data problems. */
export type OrgRootReason = "top" | "self" | "orphan" | "cycle";

export type OrgChartNode = {
  entry: OrgChartEntry;
  depth: number;                    // 0 = root; never changed by pruning
  reports: OrgChartNode[];          // input order, i.e. alphabetical from the query
  descendantCount: number;          // everyone beneath, at any depth — the `+N` badge
  rootReason: OrgRootReason | null; // set only on roots
  passThrough: boolean;             // survived pruning only because a descendant matched
};
```

### `buildOrgForest(entries): OrgChartNode[]`

Four O(n) passes:

1. **Normalise the parent edge.** `managerId == null` → root `"top"`. `managerId === id` →
   root `"self"`. `managerId` absent from the input map → root `"orphan"`. Otherwise the
   parent stands.
2. **Cut cycles** with a 3-colour **iterative** walk (no recursion — a pathological long
   chain must not blow the stack). When the walk re-enters a node already on the current
   path, null that node's own parent edge and mark it `"cycle"`. Exactly one edge dies per
   cycle; the loop unrolls into a chain. Nobody is dropped or duplicated. Deterministic
   given the query's name ordering.
3. **Materialise + link** — one node per entry, push non-roots into `parent.reports`.
4. **Annotate** `depth` and `descendantCount` post-order (safe recursion: it's a tree now).
   Then **sort roots by `descendantCount` desc, then name asc** — otherwise stray unmanaged
   ICs render above the leaders.

**Invariant to state in the JSDoc and assert in every test:**
`countOrgNodes(buildOrgForest(rows)) === rows.length`. Whatever the data does, nobody
vanishes and nobody duplicates.

Cycle/self/orphan guards are not defensive padding — ADR 0026 states explicitly that
`managerId` has **no DB-level cycle or self-reference constraint** and that every reader
must guard itself. `getFeedbackAboutReports` and `scripts/seed/performance.ts` both do.

### `pruneOrgForest(roots, matches): OrgChartNode[]`

Bottom-up rebuild, never mutates the input:

```ts
function visit(node) {
  const reports = node.reports.map(visit).filter(Boolean);
  const self = matches(node.entry);
  if (!self && reports.length === 0) return null;
  return { ...node, reports, passThrough: !self,
           descendantCount: reports.reduce((n, r) => n + 1 + r.descendantCount, 0) };
}
```

`depth` is preserved (nobody is re-parented). `descendantCount` is **recomputed over the
surviving subtree**, so a collapsed node's `+N` counts what you'd actually be hiding.

### Rest of the module

```ts
/** "No filter" is `null`, not the `ALL` sentinel — `ALL` lives in a "use client"
 *  module and this one stays pure. The toolbar maps ALL → null. */
export type OrgChartFilters = {
  search: string; lineOfBusiness: string | null; role: string | null; showInactive: boolean;
};
export function orgChartMatcher(f: OrgChartFilters): (e: OrgChartEntry) => boolean;
export function countOrgNodes(roots: readonly OrgChartNode[]): number;
export function defaultCollapsedIds(roots, expandedDepth): Set<string>;  // has reports && depth >= n
export function collapsibleIds(roots): string[];                          // "Collapse all" target
export const DEFAULT_EXPANDED_DEPTH = 2;
```

Matcher semantics: `search` = trimmed, lowercased substring on `name` (empty = no
constraint); LoB/role = exact equality, and an entry with no employment (`role === null`)
**fails** a role filter — same as the directory today; `showInactive: false` requires
`entry.isActive`.

### Tests — `src/lib/staff/org-chart.test.ts`

ADR 0037 says don't reflexively test pure functions, but carves out "a correctness
invariant genuinely beyond the type checker." This is squarely in the carve-out — the type
system cannot express *"a cyclic `managerId` graph unrolls into a finite forest containing
each person exactly once."* **Say that in the test file header** so a future reader doesn't
delete it as a 0037 violation.

`buildOrgForest`: multi-root forest · self-reference · 2-cycle · 3-cycle with a clean
subtree hanging off it · orphan (`managerId: "ghost"`) · **conservation assertion on every
fixture** · root ordering · reports preserve input order.

`pruneOrgForest`: no matches → `[]` · ancestor-only match keeps the whole chain with the
ancestors `passThrough: true` · non-matching non-ancestor siblings dropped · a matching
node's non-matching descendants dropped · post-prune `descendantCount` counts only
survivors · `depth` unchanged · **an inactive manager of an active report becomes a
pass-through, not a hole** (this is the test that pins the correction in §0).

`orgChartMatcher`: case-insensitive substring; empty search matches all; `null` dimensions
impose nothing; a `role: null` entry fails a role filter.

---

## 3. Components

```
page.tsx (server)
├─ StaffViewToggle          (server, links only)
└─ OrgChart                 ("use client") — filters, collapse, prune, drawer host
   ├─ toolbar: search Input · SelectFilter ×2 · Switch · Expand/Collapse all · count
   ├─ <ul className="flex flex-col gap-4">        ← roots, no connectors
   │  └─ OrgChartNode       ("use client", recursive)
   │     ├─ <div className="flex h-16 items-center gap-2">  [chevron] [card] [+N]
   │     └─ <ul className="ml-3 flex flex-col">   ← children; connectors live on each <li>
   └─ StaffProfileDrawer    (existing — loads on open)
```

### State in `OrgChart`

```ts
const forest = useMemo(() => buildOrgForest(entries), [entries]);
// Seeded once from the UNFILTERED forest. Filters never touch it.
const [collapsed, setCollapsed] = useState(() =>
  defaultCollapsedIds(forest, DEFAULT_EXPANDED_DEPTH));
const pruned = useMemo(() => pruneOrgForest(forest, orgChartMatcher({...})), [...]);
```

**A `Set` of COLLAPSED ids, not expanded ids.** With an expanded-set, any node the set
forgets to name is hidden — so relaxing a filter, or a new manager appearing, silently
collapses people. With a collapsed-set, absence means visible: *no person can be hidden by
a set that doesn't name them.*

No search debounce — the directory doesn't debounce either, and pruning 42 nodes per
keystroke is free.

### How filtering interacts with collapse

**Render rule: a node is expanded iff `node.passThrough || !collapsed.has(id)`.**
Pass-through nodes render expanded and **omit the disclosure control entirely**.

Pruning to matches-plus-ancestors exists to *show you where the matches are*. A collapsed
pass-through ancestor would mean the filter did invisible work — you'd get a faded "Jane
Doe +3" and have to click to find your own results. Worse, with four roots you could land
on a screen of collapsed faded cards and zero visible matches, indistinguishable from "no
results". Auto-expansion can't explode the view, because the prune already bounded the tree.

Critically this is **derived, not stateful** — we read `passThrough` at render and never
mutate `collapsed`. Clearing a filter snaps back to the user's own collapse state, not to a
tree the filter silently unfolded. That property is the whole reason `passThrough` exists as
a field.

A node that *matches* and has matching descendants **does** honour the collapse set — you
found the manager, `+3` says there's more underneath. That's a feature.

### Toolbar

Reuse `SelectFilter` + `FilterLabel` from `src/components/form/filters.tsx` (LoB →
`LINE_OF_BUSINESS_LABELS`, Role → `ROLE_LABELS`), the directory's inline `IconSearch`-prefixed
`Input`, and `Switch` for "Show inactive". Options come from the page via the existing
`staffDirectoryFilterOptions`. Plus two `Button variant="outline" size="sm"` — **Expand all**
(`setCollapsed(new Set())`) / **Collapse all** (`setCollapsed(new Set(collapsibleIds(forest)))`)
— and a muted `Showing {countOrgNodes(pruned)} of {entries.length} people`.
`pruned.length === 0` → `<EmptyState bordered>`.

Do **not** extract a shared filter bar with `StaffDirectory` — it carries seven dimensions
including skills, min-level and nearby-city. The reuse that matters (primitives + label
maps) already exists.

### The person card

Not `StaffCard` (a centred avatar-on-top tile that navigates to `/staff/[id]`). The org node
is a horizontal row that opens the existing drawer:

```tsx
<button type="button" onClick={() => onSelect(entry.id)}
  className={cn(
    "flex h-14 w-72 shrink-0 items-center gap-3 rounded-md border bg-background px-3 text-left transition-colors hover:bg-accent",
    !entry.isActive && "border-dashed bg-muted/30",
    passThrough && "opacity-60 hover:opacity-100",
  )}>
  <Avatar className="size-8">…<AvatarFallback>{initialsFor(entry.name, entry.email)}</AvatarFallback></Avatar>
  <span className="flex min-w-0 flex-col">
    <span className="truncate text-sm font-medium">{entry.name}</span>
    <span className="truncate text-xs text-muted-foreground">
      {staffMetaLine({ lineOfBusiness: entry.lineOfBusiness, role: entry.role })}
    </span>
  </span>
  {passThrough && <span className="sr-only">— shown for context; does not match the filters</span>}
</button>
```

Reuse `staffMetaLine` from `src/lib/staff/staff-summary.ts` (verified: every facet optional,
joins with a middot). **Leave `StaffCard` alone** — it hand-rolls Role-before-LoB; flipping a
shipped card's subtitle order is unrelated churn. Just don't add a third copy of the join.

Fixed `w-72`, not `w-full` — keeps each depth a tidy column and bounds total width
(36px indent/level + 288px ≈ 500px at six levels, comfortably inside `max-w-5xl`).

**Root badges:** when `rootReason` is `"self" | "orphan" | "cycle"`, render a
`<Badge variant="outline">` reading *Reports to self* / *Manager not listed* / *Reporting
loop*. This is the only surface in the app that ever shows these data problems — the
importer merely warns and nothing has displayed the result.

---

## 4. Connector lines — the CSS

Fixed row height is what makes this work without JS measurement. Per node: `<li>` has
`pl-6` (24px gutter); the row `<div>` is `h-16` (64px) containing a `size-6` chevron slot
then the `h-14` card; the elbow sits at 32px = half the row height, meeting the card's
vertical centre. The children `<ul>` gets `ml-3` (12px = half the chevron) so the spine
drops from the chevron's centre. Net indent per level: **36px**.

Two pseudo-elements **on each child `<li>`** — deliberately *not* one spine on the container,
because a container spine has to be over-painted by the last child to stop at the final
elbow, which needs an opaque background and breaks under hover.

```ts
/**
 * Connector geometry for one child row. `::before` is the vertical spine segment,
 * `::after` the horizontal elbow stub.
 *
 * `after:top-8` and `last:before:h-8` are BOTH half the row height (`h-16`) — the elbow
 * meets the card's vertical centre, and on the last child the spine stops dead at that
 * elbow instead of running past it. Change one, change both.
 *
 * The two `::before` cases are DISJOINT selectors rather than a `last:` override of a base
 * `bottom-0`, so the result never depends on Tailwind's variant sort order.
 */
const CONNECTOR =
  "pl-6 " +
  "before:absolute before:left-0 before:top-0 before:w-px before:bg-border " +
  "[&:not(:last-child)]:before:bottom-0 " +
  "last:before:h-8 " +
  "after:absolute after:left-0 after:top-8 after:h-px after:w-6 after:bg-border";
```

Concatenated **literals only** — never interpolate a variable into a class string or
Tailwind v4's scanner won't see the candidates.

**`flex flex-col` with no `gap` on the children `<ul>` is load-bearing.** Any gap between
siblings breaks the spine into dashes. Vertical rhythm comes from the row's `h-16` (56px
card inside 64px = 4px of air), not from a gap. Comment this at the `<ul>` — it's the most
likely future regression.

The root list has **no** connectors (`isRoot` suppresses `CONNECTOR`) and may use `gap-4`,
since no spine crosses it. Line colour `bg-border` — same hairline language as the existing
`border-l-2` timelines in `history-timeline.tsx`. All standard Tailwind v4 (`before:`/`after:`
inject `content: ""`; `[&:not(:last-child)]:` is a plain arbitrary variant). **No SVG, no
`globals.css` change, no dependency.**

---

## 5. Page + toggle

```tsx
export default async function StaffPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const view = firstParam(params.view) === "org" ? "org" : "directory";  // unknown → directory
  const entries = await getStaffDirectory();
  // header <h2> + <p> (copy varies by view) + <StaffViewToggle current={view} params={params} />
  // then {view === "org" ? <OrgChart …/> : <StaffDirectory …/>}
}
```

`StaffViewToggle` copies `opportunity-view-toggle.tsx` verbatim in shape (no `"use client"`;
`Button` + `render={<Link/>}` + `aria-current` + `cn(current !== x && "text-muted-foreground")`),
swapping in `buildListHref("/staff", "page", params, { view: null | "org" })` from
`src/lib/core/list-href.ts`. `/staff` has no pagination so `"page"` is a harmless no-op that
keeps the call shaped like every other. Icons: `IconLayoutGrid` / `IconSitemap` — both verified
present in the installed `@tabler/icons-react`.

---

## 6. Accessibility — a deliberate scope call

**Ship v1 as a semantic nested list, not an ARIA tree widget.** A half-built `role="tree"` is
worse than none: the moment you announce "tree", a screen-reader user expects roving
tabindex, ↑↓ through visible items, →/← to expand/collapse, Home/End and typeahead. That's
the largest single chunk of this feature and it isn't what was asked for. Nested `<ul>`/`<li>`
with a real `<button>` per node already announces correct nesting and level, is fully
Tab-navigable in reading order, and needs zero custom key handling.

- `<nav aria-label="Organization chart">` around a plain nested `<ul>`/`<li>`. No `role="tree"`,
  no `aria-level` — the DOM structure implies them.
- Disclosure is an **`IconButton`** (required by the repo rule for icon-only controls; supplies
  tooltip + aria-label) with `aria-expanded` and `aria-controls={useId()}` → the children `<ul>`.
  Same shape as the plan-editor's expandable rows.
- Label carries the count: `Expand Jane Doe's reports (42)` / `Collapse Jane Doe's reports`.
  The `+42` badge is then reinforcement, not the only channel.
- Leaves render a `size-6` `<span aria-hidden>` spacer so cards stay column-aligned without a
  fake disabled button in the tab order.
- Pass-through cards append the `sr-only` context note — `opacity-60` is invisible to AT.

Note the full tree-widget upgrade in the ADR's Open questions; it's additive to this markup.

---

## 7. Edge cases

1. **Cycle** → one edge cut, `Reporting loop` badge. Guarded, tested, surfaced.
2. **Self-reference** → `"self"`, pre-normalised so it reads distinctly from a general cycle.
3. **Dangling `managerId`** → `"orphan"`, rendered with a *Manager not listed* badge. Can't
   happen with today's read; the guard is what lets a future filtered read not amputate a subtree.
4. **Inactive manager, "show inactive" off** → faded pass-through, reports stay attached. If
   someone later "optimises" this into a pre-filter the tree shatters — flag it in the JSDoc.
5. **Forest, not one root** — 4 seeded roots, sorted biggest-subtree-first.
6. **Root with zero reports** — lone card, no toggle, no spine. Expected: seed assignment is
   random, so some managers legitimately have none.
7. **Everything filtered out** → `EmptyState`.
8. **Match behind a collapsed pass-through** — impossible by construction.
9. **`+N` showing pre-filter counts** — prevented by recomputing inside the prune.
10. **Filter change stomping collapse state** — prevented by keeping expansion derived.
11. **50 reports under one manager** → one ~3,200px column. Intended. Mitigations shipped:
    collapse, `+N`, Collapse all. **No virtualization in v1** — unwarranted at 42 people; say so
    in the ADR so it reads as a decision.
12. **Very deep org** → 36px/level; `max-w-5xl` holds ~8 levels. Note it, don't solve it.
13. **`staffRating.level` stays off the chart entirely** — the read never fetches it, so the
    `ratings.view` gate can't be sidestepped by a component choice.
14. **No new permission surface.** `loadStaffProfileDrawer` already gates each sensitive slice
    internally (compensation/PTO/feedback/review-notes come back `null` for an unpermitted
    viewer). Any authenticated user may open a node; no new gate is needed and none should be
    added. State this explicitly in the ADR.
15. **Purity boundary** — `org-chart.ts` must not import `server-only`, `db`, or `@/components/**`.

---

## 8. Verification

```
bun test src/lib/staff/org-chart.test.ts   # fast loop while building the tree module
bun run check                              # biome + tsc --noEmit + bun test (incl. RBAC matrix)
bun run build                              # non-optional: catches server/client boundary violations
```

`bun run build` matters here — importing anything `server-only`-tainted into `org-chart.ts`
typechecks fine and fails only at build.

**Seeded expectations** (`scripts/seed/staff.ts`): 42 staff, 4 roots, 3 levels.
`countOrgNodes(buildOrgForest(entries))` must equal 42; the four leaders' `descendantCount`
sums to 38. At `DEFAULT_EXPANDED_DEPTH = 2` all three levels show → 42 cards, ~2,700px of scroll.

**Click-through:**

1. `/staff` → Directory renders exactly as today (regression check on the `managerId` addition).
2. Toggle → `/staff?view=org`; `aria-current` moves; toggling back drops the param cleanly.
3. **Spine geometry at all three depths**: every elbow meets its card's vertical centre; the
   spine is unbroken between siblings; **the last child's spine stops at its own elbow.**
4. Collapse a manager → children vanish, chevron rotates, `+N` shows the right count.
5. Collapse all → 4 roots remain. Expand all → 42 back.
6. **LoB = Fintech** → non-Fintech ancestors appear faded with no chevron; every non-faded card
   is Fintech; nothing is stranded without a parent chain.
7. **Role = Designer** → confirm a matching IC under a non-matching manager under a non-matching
   leader shows the full 3-card chain.
8. **Filter then clear** → collapse state returns to exactly what it was (the derived-not-stateful
   property).
9. Search live-prunes per keystroke; gibberish → `EmptyState`, not a blank page.
10. **Show inactive**: flip one staff row inactive in `db:studio` — with the switch off, an
    inactive *manager* renders faded with reports still attached (not promoted to a root); an
    inactive *leaf* disappears.
11. Click a card → `StaffProfileDrawer` opens and loads; "Open full profile" navigates; closing
    returns with scroll and collapse intact.
12. **Keyboard**: Tab reaches every chevron and card in reading order; Enter/Space toggles; Enter
    on a card opens the drawer; focus rings visible.
13. **Cycle rendering** (manual): in `db:studio` point two staff at each other, reload → both
    appear once, one carries *Reporting loop*, the page does not hang. Revert.

**After merge:** dispatch the `librarian` subagent to reconcile `/docs` (new view in
`docs/domains/staff-profiles.md`, the connector technique in `docs/ui.md`, ADR 0054), and run
`/code-review` before shipping.
