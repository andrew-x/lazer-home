# 0054 — The staff org chart is an indented DOM tree, and filters prune to matches plus ancestors

**Status:** accepted · 2026-07-30

## Context

`staff.managerId` has existed since [ADR 0026](./0026-staff-manager-self-reference.md)
but nothing rendered it beyond a single "Reports to" link on a profile. `/staff` needed
a way to see the reporting structure — people as nodes, reporting lines as edges,
filterable by line of business and role.

Three constraints shaped it:

1. [docs/ui.md](../ui.md) forbids adding a charting dependency; all data viz in this app
   is hand-rolled.
2. Fan-out is unbounded. A manager with 50 direct reports is a realistic case, and the
   classic spreading top-down chart turns that into a ~5,000px-wide row.
3. `managerId` is **not a trustworthy tree**. It has no DB-level cycle or self-reference
   constraint and the CSV importer only warns (ADR 0026), so the renderer is handed a
   graph.

## Decision

### 1. An indented DOM tree, not a canvas

Nested `<ul>`/`<li>`, one fixed-height row per person (a card: avatar, name,
`staffMetaLine`), with the reporting lines drawn as **CSS pseudo-element connectors** —
`::before` a vertical spine, `::after` a horizontal elbow, on each child `<li>`.

No SVG, no library, no dependency. Beyond honouring the ui.md rule, indenting is what
actually solves constraint 2: 50 reports become one narrow scrollable column instead of a
5,000px row, and the page scrolls vertically like any other page — no pan/zoom to build.

The connectors carry interlocking magic numbers (`after:top-8` and `last:before:h-8` are
both half the `h-16` row height; the elbow is `w-6` to a chevron but `w-14` to a leaf's
card). They live in one commented constant in `org-chart-node.tsx`. Two consequences worth
knowing: the class string must be **literal concatenation** or Tailwind v4's scanner won't
emit the candidates, and the nested `<ul>` must have **no `gap`** or the spine breaks into
dashes.

Rejected: `@xyflow/react` + `dagre`. It would have given pan/zoom/minimap free, but at the
cost of two dependencies, a departure from ui.md, restyling React Flow's rounded/shadowed
defaults, and — decisively — it doesn't solve the wide-fan-out problem, it just lets you
pan across it.

### 2. Filters prune to matches **plus their ancestor chain**

Filtering a tree breaks it: filter to Engineers and a Designer manager sitting between two
Engineers vanishes, stranding her reports. So a non-matching node is kept whenever a
descendant matched, flagged `passThrough`, and rendered faded with an `sr-only` note.
Non-matching nodes with no surviving descendant are dropped entirely.

Two properties fall out of this that are easy to break later:

- **`descendantCount` is recomputed over the surviving subtree**, so a collapsed node's
  `+N` badge counts what you would actually be hiding, not the person's company-wide span.
- **While a filter is active the whole pruned tree renders expanded, with no disclosure
  controls.** The first cut of this only force-expanded `passThrough` nodes, which was
  wrong: a node that *matched* and had matching descendants still honoured the collapse
  set, so a wide manager seeded collapsed by the width rule below would answer "Role =
  Engineer" with a `+20` badge and none of the twenty engineers. Because the prune leaves
  only matches and the chains to them, any surviving node with reports has a match beneath
  it — so "expand everything while filtering" is not a heuristic, it is what the prune
  already implies. This is **derived at render time, never stored**: clearing the filter
  snaps back to the user's own collapse state rather than to a tree the filter unfolded.
- **"Show inactive" is excluded from that rule.** Hiding departed staff is the baseline
  view rather than a narrowing the user asked for; counting it would force the tree open
  on first load and make collapse unreachable.
- **The count reports matches, not rendered rows** (`countOrgMatches`), or narrowing to one
  person would read "showing 6 of 42".

### 3. "Show inactive" is a prune predicate, not a pre-filter

Every filter — including `isActive` — runs through the prune; the forest is always built
from **all** entries. Filtering inactive people out of the *input* would turn an inactive
manager into a missing parent and detach her whole subtree to the top level. Routed through
the prune she renders as a faded pass-through with her reports still attached. There is a
test pinning this; if someone later "optimises" it into a pre-filter, the tree shatters.

### 4. The builder guards itself, and surfaces what it finds

`buildOrgForest` normalises self-references, dangling `managerId`s and cycles into roots
carrying an `OrgRootReason` (`self` / `orphan` / `cycle`), cutting exactly one edge per
cycle via an **iterative** 3-colour walk (recursion would risk the stack on a pathological
chain). Its contract: **every input row appears in the output exactly once**, whatever the
edges do.

The chart renders those reasons as badges — *Reports to self*, *Manager not listed*,
*Reporting loop*. This is the only surface in the app that shows this class of data
problem; the importer merely warns and nothing has ever displayed the result.

`src/lib/staff/org-chart.test.ts` exists for this. It is a deliberate instance of
[ADR 0037](./0037-unit-tests-removed-except-rbac-matrix.md)'s "genuinely beyond the type
checker" carve-out, not a backslide toward a broad pure-function suite.

### 5. Default collapse is depth **or** width

A node starts collapsed if it has reports and is either deep (`depth >= 2`) or wide
(`> LARGE_FAN_OUT`, 12 direct reports). Depth alone leaves a 50-report manager fully
expanded whenever they sit shallow in the org — which is exactly where big teams sit. At
today's seeded scale (42 people, max fan-out 6) nothing collapses and the whole org shows,
which is the point of an org chart.

### 6. One read, one page, `?view=` in the URL

`getStaffDirectory` gained `managerId` rather than a sibling `getOrgChart.ts`. It had
exactly one caller, and a second copy of the two-query + `latestEmploymentFirst` +
`firstPerKey` shape is where the effective-dating rule drifts. One entry type also makes
"line of business = Fintech" structurally mean the same people in both views.

`?view=org` is the only staff search param — a link-based toggle mirroring the
opportunities board/list switch, so a chart is deep-linkable — while everything *inside*
each view filters in memory with `useState`, per ui.md's rule for filters over an
already-fetched list.

## Consequences

- **No migration and no new permission surface.** The edge already existed. Every node
  opens the existing `StaffProfileDrawer`, which already nulls out compensation, PTO,
  feedback and review notes server-side for an unpermitted viewer. `staffRating.level` is
  never fetched by this read, so the `ratings.view` gate cannot be sidestepped by a
  component choice.
- **The chart is read-only.** `managerId` stays import-only; ADR 0026 is explicit that an
  in-app editor would be a **permission-granting** write, because the reporting line gates
  review-note access ([ADR 0049](./0049-review-notes-reporting-line-as-authorization-boundary.md)).
  That remains a decision to revisit deliberately, not a gap to fill.
- **Semantic nested list, not an ARIA tree widget.** Announcing `role="tree"` obliges
  roving tabindex, arrow traversal, Home/End and typeahead; a half-built one is worse than
  none. Nested lists with a real `<button>` per node already convey nesting and are fully
  Tab-navigable. Upgrading later is additive to the same markup.
- **No virtualization.** At company scale the whole org is a few thousand pixels of
  ordinary scroll. Collapse, `+N` and Collapse all are the mitigations.
- **`managerId` still has no index.** The read is a full scan into memory either way.
- Indent grows 36px per level; `max-w-5xl` comfortably holds ~8 levels. Deeper than that
  and the card or the indent would need to shrink. Not a today problem.

## Open questions

- A full ARIA tree widget (roving tabindex + arrow keys) if keyboard users ask for it.
- Whether the chart should offer a "focus on this person" re-rooting mode (the
  Rippling/Workday pattern) once real orgs are deeper than the seeded three levels.
