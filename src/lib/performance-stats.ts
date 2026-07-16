/**
 * Aggregate compensation statistics for the performance dashboard. Pure and
 * side-effect-free so it runs on the client (recomputing as filters / currency
 * change) and is unit-testable in isolation.
 *
 * Callers pass rows whose `comp` and `hourly` are ALREADY normalized to the
 * display currency — this module does no FX (see `@/lib/fx`), only arithmetic.
 */

/** One person's normalized figures, tagged with their role for grouping. */
export type StatRow = {
  role: string;
  comp: number;
  hourly: number;
};

/**
 * Aggregate figures for a set of people. Amounts are null for an empty group
 * (no rows) so the UI can render an em dash instead of NaN / 0.
 */
export type GroupStats = {
  headcount: number;
  avgComp: number | null;
  minComp: number | null;
  maxComp: number | null;
  avgHourly: number | null;
  minHourly: number | null;
  maxHourly: number | null;
};

/** A role plus its aggregate stats, for the by-role breakdown table. */
export type RoleBreakdown = { role: string; stats: GroupStats };

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Aggregate a set of normalized rows into a single {@link GroupStats}. */
export function computeGroupStats(rows: readonly StatRow[]): GroupStats {
  if (rows.length === 0) {
    return {
      headcount: 0,
      avgComp: null,
      minComp: null,
      maxComp: null,
      avgHourly: null,
      minHourly: null,
      maxHourly: null,
    };
  }

  const comps = rows.map((r) => r.comp);
  const hourlies = rows.map((r) => r.hourly);

  return {
    headcount: rows.length,
    avgComp: mean(comps),
    minComp: Math.min(...comps),
    maxComp: Math.max(...comps),
    avgHourly: mean(hourlies),
    minHourly: Math.min(...hourlies),
    maxHourly: Math.max(...hourlies),
  };
}

/**
 * Compute overall stats plus a per-role breakdown. Roles are emitted in
 * `roleOrder`, skipping any role with no people, so the table reads in a stable,
 * intentional order rather than data-arrival order.
 */
export function computeByRole(
  rows: readonly StatRow[],
  roleOrder: readonly string[],
): { overall: GroupStats; byRole: RoleBreakdown[] } {
  const byRole = roleOrder
    .map((role) => ({
      role,
      rows: rows.filter((r) => r.role === role),
    }))
    .filter((group) => group.rows.length > 0)
    .map((group) => ({
      role: group.role,
      stats: computeGroupStats(group.rows),
    }));

  return { overall: computeGroupStats(rows), byRole };
}
