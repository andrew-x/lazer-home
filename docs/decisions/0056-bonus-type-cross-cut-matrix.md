# 0056 — Bonus type as a cross-cut matrix (money-only cells), and a dashboard-local filter slot

**Status:** accepted · 2026-07-30 · builds on
[ADR 0055](./0055-nav-dashboards-vs-people-management.md) (which made
`/reporting/bonuses` a page of its own)

**TL;DR:** the bonus dashboard gains (a) a **type × line-of-business / role matrix**
whose cells show **money only** — per-cell recipient counts would look like an
arithmetic error, because recipients are *distinct* counts that don't sum — and (b) a
**bonus-type filter held by the bonus dashboard itself**, passed into the shared
`DashboardFilterBar` through a new `extraFilters` slot rather than added to
`useDashboardFilters`. No schema, read or gate change.

## Context

The dashboard broke one calendar year's payments down along **three independent
axes** — line of business, role, bonus type — each its own table over the same
filtered, FX-normalized rows. Three totals that agree, and no way to see *inside* a
row: a discretionary-heavy team and a spot-heavy one with the same spend are
indistinguishable, which is exactly the distinction
`src/lib/staff/staff-bonus.ts` says the type enum exists to preserve
(`DISCRETIONARY` = decided in a review cycle; `SPOT` = handed out between cycles).

Adding "type within X" needed two things the page didn't have: a two-dimensional
aggregate, and a way to *narrow* to one type without touching the shared
dashboard-filter module used by the compensation and levels dashboards, where the
dimension doesn't exist at all.

## Decision

### 1. A cross-cut matrix, not a fourth axis table

`computeBonusMatrix(rows, rowOrder, colOrder)` in
`src/lib/performance/bonus-stats.ts` — pure, client-importable, tested — crossing
`BonusMatrixRow { recipientKey, row, col, amount }` into a `BonusMatrix`. Its
contract deliberately mirrors `computeBonusBreakdown`:

- rows and columns emitted **in the given order** (the enum's order, not the data's);
- **wholly empty rows and columns are skipped** — no dead "Referral" column in a year
  with no referral bonuses;
- values outside the given orders land in **`overall` only** — `bonusGroupsCovered`
  is the assertion tool, now applied per dimension;
- an empty **intersection is `null`**, not zeroed stats, so the UI renders an em dash
  instead of a misleading `$0` (same reason `computeGroupStats` returns `null`).

`computeBonusStats` was widened to `Pick<BonusStatRow, "recipientKey" | "amount">` —
it never read `group` — which is what lets the one-dimensional rows and the matrix's
two-dimensional rows share it instead of duplicating the aggregation.

`BonusTypeMatrix` (`src/components/performance/bonus-type-matrix.tsx`) renders it with
a local `ToggleGroup` picking which dimension goes down the side. The axis heading and
label map come from `CROSS_CUT_AXES` in `bonus-breakdown.tsx`, shared with the
single-axis tables so the two can't disagree on what "Line of business" is called.

### 2. Cells show money only

**Only `total` sums cleanly across a matrix.** `recipients` is a *distinct* count, so
one person paid a spot *and* a signing bonus is one recipient in two cells and still
one in the margin — the cells would visibly fail to add up to the row total, and a
reader would reasonably conclude the page is broken rather than that the metric is
non-additive. `payments` and `avgPerRecipient` inherit the problem (the average's
denominator is the distinct count).

So the matrix is money-only, with an on-screen note saying so, and the **three
single-axis tables remain the place to count people** — they keep all four metrics
because a single axis partitions the payments cleanly.

### 3. Nothing renders below two type columns

`if (matrix.columns.length < 2) return null`. With one type in play — the type filter
is set, or a thin year — every cell just repeats the axis table's Total column. A
one-column matrix is not a smaller insight, it's the same insight twice.

### 4. Bonus type is a dashboard-local filter, via `extraFilters`

`DashboardFilterBar` gains `extraFilters?: ReactNode`, rendered at the end of the
dimension row. `bonus-dashboard.tsx` owns the `bonusType` state (a `SegmentedFilter`
over `BONUS_TYPES`) and passes the control in.

**Bonus type must stay out of `useDashboardFilters` and `matchesFilters`.** Those are
shared by `/reporting/compensation` and `/reporting/levels`, where no row has a
bonus type: putting it in the hook would either render a dead control on two other
dashboards or need a per-dashboard visibility flag threaded through the shared module.
The slot is the documented escape hatch for **a dimension exactly one dashboard has** —
the same reasoning that already makes `rates` optional (the currency toggle renders iff
the caller passes rates).

The type filter narrows **the one shared payment set, before any axis is built.** That
is load-bearing: `BonusBreakdown` takes `overall = byAxis[0].overall` for its stat
cards, which is only honest while the cards, all three axis tables and the matrix
aggregate identical rows. Filtering per-axis, or filtering the matrix only, would make
the footers contradict the cards.

## Consequences

- **The matrix is a client-side recompute, like everything else on the page.** No new
  read, no new column, no gate change: `BonusRecord` already carried
  `lineOfBusiness`, `role` and `type`, and `recipientKey` is still the anonymized
  per-request token ([ADR 0055](./0055-nav-dashboards-vs-people-management.md),
  `getBonusSummaryData`). FX stays in `bonus-breakdown.tsx` — the matrix receives
  amounts already normalized, so every figure on the page is converted exactly once.
- **`extraFilters` is now a precedent.** A dashboard-specific dimension goes in the
  slot; a dimension two or more dashboards share goes into `useDashboardFilters` +
  `matchesFilters`. If a *third* dashboard-local filter appears, revisit — but don't
  grow the shared hook to hold single-consumer state.
- **The matrix can disappear.** Filtering to one bonus type removes it. That is
  intended (see §3) and is why the stat cards and axis tables, not the matrix, carry
  the page's totals.

## Alternatives considered

- **Show recipients (or all four metrics) per cell.** Rejected — see §2. The numbers
  would be individually correct and collectively look wrong, which is worse than
  absent for a spend figure people reconcile against Rippling.
- **Add `bonusType` to `useDashboardFilters`.** Rejected: it puts a dimension that
  doesn't exist for compensation or levels rows into the module those pages share, and
  `matchesFilters` would have to ignore a field its callers can't supply.
- **A fourth single-axis table, "type within the selected line of business".** Rejected:
  it makes the LoB filter mandatory to read the type mix, and answers one row at a time
  when the question ("who spends on what") is comparative.
- **Aggregate the matrix server-side.** Rejected: the client already holds the
  filtered, currency-normalized rows and recomputes on every filter/currency change;
  a server matrix would need a re-read per toggle and a second FX path.
- **Render a zeroed `$0` for empty intersections.** Rejected: `$0` claims "we paid
  nothing of this type here" with the same visual weight as a real figure. An em dash
  says "no payments", which is what the `null` cell means.
