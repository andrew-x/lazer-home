/**
 * Aggregate bonus-payment statistics for the bonus dashboard. Pure and
 * side-effect-free so it runs on the client (recomputing as filters / currency
 * change) and is unit-testable — same contract as `performance-stats.ts`.
 *
 * Callers pass rows whose `amount` is ALREADY normalized to the display currency;
 * this module does no FX (see `@/lib/format/fx`), only arithmetic.
 *
 * Unlike the comp breakdowns, these rows are **payments, not people**: one person
 * can appear several times. Every count here is therefore either a payment count
 * or a distinct-recipient count, never a headcount — conflating them would
 * overstate how many people were paid.
 */

/** One normalized payment, tagged with the dimensions it is grouped by. */
export type BonusStatRow = {
  /** Stable per-person key used only to count distinct recipients. Never displayed. */
  recipientKey: string;
  /** Whatever dimension this breakdown groups on (a role, an LoB, a type). */
  group: string;
  amount: number;
};

export type BonusGroupStats = {
  /** Summed amount. 0 for an empty group — a total of nothing IS zero here. */
  total: number;
  /** Number of payments, not people. */
  payments: number;
  /** Distinct people paid. */
  recipients: number;
  /** Total ÷ recipients, or null for an empty group so the UI renders an em dash. */
  avgPerRecipient: number | null;
};

export type BonusBreakdown = { group: string; stats: BonusGroupStats };

/**
 * Aggregate a set of normalized payments into a single {@link BonusGroupStats}.
 *
 * Takes only the fields it reads — who was paid and how much — so it serves both
 * the one-dimensional rows and the two-dimensional {@link BonusMatrixRow}s.
 */
export function computeBonusStats(
  rows: readonly Pick<BonusStatRow, "recipientKey" | "amount">[],
): BonusGroupStats {
  if (rows.length === 0) {
    return { total: 0, payments: 0, recipients: 0, avgPerRecipient: null };
  }

  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const recipients = new Set(rows.map((r) => r.recipientKey)).size;

  return {
    total,
    payments: rows.length,
    // Per RECIPIENT, not per payment: "the average person who got a bonus got
    // this much", which is the question a reader is actually asking.
    recipients,
    avgPerRecipient: total / recipients,
  };
}

/**
 * Overall stats plus a breakdown over `groupOrder`.
 *
 * Groups are emitted in `groupOrder`, skipping any with no payments, so a table
 * reads in a stable, intentional order rather than data-arrival order. Rows whose
 * `group` is absent from `groupOrder` are counted in `overall` but appear in no
 * group row — the caller controls the axis, and a silently-dropped row would make
 * the group totals fail to sum to the overall one. {@link bonusGroupsCovered}
 * lets a caller assert that never happens.
 */
export function computeBonusBreakdown(
  rows: readonly BonusStatRow[],
  groupOrder: readonly string[],
): { overall: BonusGroupStats; groups: BonusBreakdown[] } {
  const groups = groupOrder
    .map((group) => ({ group, rows: rows.filter((r) => r.group === group) }))
    .filter((g) => g.rows.length > 0)
    .map((g) => ({ group: g.group, stats: computeBonusStats(g.rows) }));

  return { overall: computeBonusStats(rows), groups };
}

/** One normalized payment tagged with the TWO dimensions a matrix crosses. */
export type BonusMatrixRow = {
  /** Stable per-person key used only to count distinct recipients. Never displayed. */
  recipientKey: string;
  /** The dimension down the side (a line of business, a role). */
  row: string;
  /** The dimension across the top (a bonus type). */
  col: string;
  amount: number;
};

export type BonusMatrix = {
  /**
   * The columns that actually have payments, in `colOrder`. Index-aligned with
   * every row's `cells` and with `columnTotals`, so the header, the body and the
   * footer can never drift apart.
   */
  columns: string[];
  rows: {
    row: string;
    /** One per entry in {@link BonusMatrix.columns}; `null` where nothing was paid. */
    cells: (BonusGroupStats | null)[];
    total: BonusGroupStats;
  }[];
  columnTotals: BonusGroupStats[];
  overall: BonusGroupStats;
};

/**
 * Cross two dimensions — the same payments {@link computeBonusBreakdown} groups
 * along one axis, split along a second.
 *
 * Rows and columns are emitted in the given order, skipping any that are wholly
 * empty (a year with no referral bonuses gets no dead column), and an empty
 * *intersection* is `null` rather than zeroed stats so the UI renders an em dash
 * instead of a misleading `$0`. As in `computeBonusBreakdown`, rows outside
 * `rowOrder`/`colOrder` are counted in `overall` only — assert with
 * {@link bonusGroupsCovered} over each dimension.
 *
 * Only `total` sums cleanly across a matrix: the recipient counts are DISTINCT
 * counts, so one person paid two kinds of bonus is one recipient in two cells and
 * still one in the margins. Displaying per-cell recipients alongside a margin
 * would therefore look like an arithmetic error — hence the money-only table.
 */
export function computeBonusMatrix(
  rows: readonly BonusMatrixRow[],
  rowOrder: readonly string[],
  colOrder: readonly string[],
): BonusMatrix {
  const columns = colOrder.filter((col) => rows.some((r) => r.col === col));

  return {
    columns,
    rows: rowOrder
      .map((row) => ({ row, rows: rows.filter((r) => r.row === row) }))
      .filter((group) => group.rows.length > 0)
      .map((group) => ({
        row: group.row,
        cells: columns.map((col) => {
          const cell = group.rows.filter((r) => r.col === col);
          return cell.length > 0 ? computeBonusStats(cell) : null;
        }),
        total: computeBonusStats(group.rows),
      })),
    columnTotals: columns.map((col) =>
      computeBonusStats(rows.filter((r) => r.col === col)),
    ),
    overall: computeBonusStats(rows),
  };
}

/**
 * True when every row's group appears in `groupOrder` — i.e. the breakdown's rows
 * sum to its overall total. Used by the tests to pin the invariant for each axis
 * the dashboard offers.
 */
export function bonusGroupsCovered(
  rows: readonly BonusStatRow[],
  groupOrder: readonly string[],
): boolean {
  const known = new Set(groupOrder);
  return rows.every((r) => known.has(r.group));
}
