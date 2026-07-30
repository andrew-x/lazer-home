/**
 * Aggregate bonus-payment statistics for the compensation dashboard. Pure and
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

/** Aggregate a set of normalized payments into a single {@link BonusGroupStats}. */
export function computeBonusStats(
  rows: readonly BonusStatRow[],
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
