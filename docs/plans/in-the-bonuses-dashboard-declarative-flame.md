# Bonus type as a cross-cut, and as a filter

## Context

The Bonuses dashboard (`/dashboards/bonuses`) already breaks one calendar year's
payments down along three independent axes — line of business, role, bonus type —
each as its own table (`bonus-breakdown.tsx:84-88`, rendered by one generic loop at
`215-267`).

Two gaps remain:

1. **Type is only ever an axis, never a filter.** `matchesFilters`
   (`dashboard-filters.tsx:66`) knows only line of business / role / employment
   type, so there is no way to ask "what did we spend on *spot* bonuses, by role?"
2. **The three axes never meet.** You can see total spend per line of business and
   total spend per type, but not how each line of business's spend *splits across*
   types — the question that distinguishes a discretionary-heavy team from a
   spot-heavy one.

Outcome: a **type × (line of business | role) matrix** below the existing tables,
plus a **Bonus type** segment in the control bar that scopes every number on the
page.

## Approach

### 1. `computeBonusMatrix` — new pure helper in `src/lib/performance/bonus-stats.ts`

`computeBonusBreakdown`'s flat `group: string` can't express a cross-cut, so add a
sibling built from the existing `computeBonusStats`:

```ts
export type BonusMatrixRow = {
  recipientKey: string;
  row: string;   // the dimension down the side (an LoB, a role)
  col: string;   // the dimension across the top (a bonus type)
  amount: number;
};

export type BonusMatrix = {
  /** Columns actually present, in `colOrder`. Index-aligned with every `cells`. */
  columns: string[];
  rows: { row: string; cells: (BonusGroupStats | null)[]; total: BonusGroupStats }[];
  /** One per column, index-aligned with `columns`. */
  columnTotals: BonusGroupStats[];
  overall: BonusGroupStats;
};

export function computeBonusMatrix(
  rows: readonly BonusMatrixRow[],
  rowOrder: readonly string[],
  colOrder: readonly string[],
): BonusMatrix;
```

Contract, matching `computeBonusBreakdown`'s existing behaviour:

- Rows and columns are emitted in the given order, **skipping wholly empty ones**
  (a year with no `REFERRAL` bonuses gets no dead column).
- An empty *intersection* is `null`, not a zero-stats object — the UI renders an
  em dash there, and `null` makes that unmissable.
- Rows/cols outside `rowOrder`/`colOrder` land in `overall` only; the existing
  `bonusGroupsCovered` is the assertion tool for both dimensions.
- Amounts arrive already FX-normalized — no FX in this module (unchanged rule).

### 2. Tests — `src/lib/performance/bonus-stats.test.ts`

Add a `describe("computeBonusMatrix")` block pinning the invariants that would
otherwise produce plausible wrong numbers:

- Cells sum to their row total **and** to their column total; both margins sum to
  `overall`.
- An empty intersection is `null`; an all-empty row/column is absent.
- A person paid in two different cells counts **once in each** cell, once in the
  row total, and once in `overall` — distinct counts never sum. (This is why cells
  show money only; see below.)
- `bonusGroupsCovered` flags a stray row value and a stray column value.

### 3. `BonusTypeMatrix` — new client component

`src/components/performance/bonus-type-matrix.tsx`. Kept out of
`bonus-breakdown.tsx` (already ~280 lines) and owns only the presentation:

```tsx
export type MatrixAxis = {
  key: "lineOfBusiness" | "role";
  heading: string;
  order: readonly string[];
  labels: Record<string, string>;
};

export function BonusTypeMatrix({ rows, axes, money }: {
  /** Filtered payments, amounts already in the display currency. */
  rows: readonly {
    recipientKey: string; lineOfBusiness: string; role: string;
    type: string; amount: number;
  }[];
  axes: readonly MatrixAxis[];
  money: (value: number | null) => string;
}): ReactNode
```

- Owns a `useState<MatrixAxis["key"]>("lineOfBusiness")` row-axis picker, rendered
  as a `ToggleGroup` — same local-toggle precedent as `compensation-dashboard.tsx:69`
  (`chartMetric`) and the `YearPicker` in `bonus-breakdown.tsx:47`.
- Maps `rows` to `BonusMatrixRow[]` on the selected axis, calls
  `computeBonusMatrix(…, axis.order, BONUS_TYPES)` in a `useMemo`.
- Renders the `Table` primitives inside a `rounded border` div (matching the axis
  tables), with a header strip carrying an `<h3>` and the axis toggle. Column
  headers are `BONUS_TYPE_LABELS`, plus a trailing **All** margin column and an
  **All** `TableFooter` row.
- Wrap the table in `overflow-x-auto` — 6 types + All is 7 numeric columns on a
  `max-w-5xl` page, so it must scroll itself rather than widening the page (the
  same reason `SegmentedFilter` wraps its group, `filters.tsx:247`).
- **Cells are money only.** Payments/recipients per cell would need per-cell margins
  that don't add up (a person paid a spot *and* a signing bonus is one recipient in
  two cells), so the matrix answers "where did the money go" and the axis tables
  above keep answering "how many people". Say this in a `figcaption`-style caption
  under the table.
- Render the block only when `columns.length > 1`. With one type present — because
  of the new filter, or a thin year — every cell would just repeat the LoB/Role
  table's Total column.

### 4. Bonus type filter

Deliberately **not** added to `useDashboardFilters`/`matchesFilters`
(`dashboard-filters.tsx`) — that module is shared with the compensation and levels
dashboards, where bonus type is meaningless. Instead:

- **`dashboard-filters.tsx`** — `DashboardFilterBar` gains one optional
  `extraFilters?: ReactNode`, rendered as the last child of the dimension flex row
  (`107-129`) so it wraps alongside the other three. Document it as the slot for a
  dashboard-specific dimension. Nothing else in that file changes; the other two
  dashboards omit the prop and are untouched.
- **`bonus-dashboard.tsx`** — `const [bonusType, setBonusType] = useState(ALL)`,
  passed to the bar as
  `extraFilters={<SegmentedFilter label="Bonus type" value={bonusType} options={BONUS_TYPES} labels={BONUS_TYPE_LABELS} onChange={setBonusType} />}`,
  and down to `BonusBreakdown` as a new `bonusType` prop.
- **`bonus-breakdown.tsx`** — inside the existing `useMemo` (`132`), narrow
  `filtered` by `bonusType === ALL || r.type === bonusType` **before** building any
  axis, then build the normalized rows once and pass them to `BonusTypeMatrix`.

  Applying the type filter to the shared `filtered` set is what keeps the
  `overall = byAxis[0].overall` shortcut at line 172 honest — every axis, the stat
  cards and the matrix must aggregate the identical row set, or the footers start
  contradicting the cards. Add `bonusType` to the memo's dep array.

  Hoist the static `labels` map (`149-153`) to a module constant so the matrix's
  `axes` array can reuse it; `order` stays in the memo (it depends on
  `filterOptions`). The three existing axis tables are otherwise unchanged.

### 5. Copy touch-ups

- `bonuses/page.tsx:51-54` subtitle and the `BonusBreakdown` doc comment
  (`92-109`): mention the type cross-cut.
- The existing empty state ("No bonus payments in {year} match the selected
  filters", `210-213`) already covers the new filter — no change.

### 6. Docs

Dispatch the `librarian` subagent (per `AGENTS.md`) with a summary: new
`computeBonusMatrix`, the type cross-cut table, the bonus-type filter and the
`extraFilters` slot on the shared filter bar. It reconciles
`docs/domains/performance.md` (route table ~`238`, shared-filter-module notes
~`256-279`) and `docs/ui.md`.

## Files

| File | Change |
|---|---|
| `src/lib/performance/bonus-stats.ts` | add `BonusMatrixRow`, `BonusMatrix`, `computeBonusMatrix` |
| `src/lib/performance/bonus-stats.test.ts` | new `computeBonusMatrix` describe block |
| `src/components/performance/bonus-type-matrix.tsx` | **new** — matrix table + axis toggle |
| `src/components/performance/bonus-breakdown.tsx` | type filtering in the memo; render the matrix; hoist labels |
| `src/components/performance/bonus-dashboard.tsx` | own `bonusType` state; pass `extraFilters` |
| `src/components/performance/dashboard-filters.tsx` | optional `extraFilters` slot on `DashboardFilterBar` |
| `src/app/(app)/dashboards/bonuses/page.tsx` | subtitle copy |

No schema change, no new server read: `BonusRecord`
(`getBonusSummaryData.ts:36-44`) already carries `lineOfBusiness`, `role` and
`type` per payment, and `recipientKey` stays the anonymized per-request token — no
new identity-linked dimension crosses the wire, so the RBAC gate
(`BONUS_PAYMENT_READ_ACCESS`) is untouched.

## Verification

1. `bun run check` — Biome + `tsc --noEmit` + `bun test` (the new matrix tests must
   pass; `bun test src/lib/performance/bonus-stats.test.ts` while iterating).
2. `bun run build`.
3. `bun run dev`, sign in as a user with `staff.viewCompensation`, open
   `/dashboards/bonuses`:
   - Matrix cells sum across to the **All** column and down to the **All** footer
     row, and that footer total equals the **Total paid** stat card.
   - Toggling the row axis between Line of business and Role keeps the same grand
     total; toggling CAD/USD moves matrix and tables together.
   - Selecting a single **Bonus type** narrows the stat cards, all three axis
     tables and the by-type table consistently, and **hides** the matrix (one
     column); switching back to All brings it back.
   - Combining the type filter with a line-of-business/role filter down to zero
     rows shows the existing empty state, not an empty table shell.
   - Changing year preserves both the type filter and the matrix axis (client
     state survives the `router.push`), and the viewport doesn't jump.
   - The matrix scrolls horizontally inside its border on a narrow window; the
     page itself never scrolls sideways.
