/**
 * Aggregate statistics over staff rating levels for the Levels dashboard. Pure
 * and side-effect-free so it runs on the client (recomputing as filters change)
 * and is unit-testable in isolation.
 *
 * A level is an integer 0–4 or `null` (unrated). The comp/rate-per-level table is
 * handled separately by `computeByRole` in `@/lib/performance/performance-stats` (tagging the
 * grouping key with the level label); this module owns the level-specific math:
 * the distribution, the unrated count, and average levels.
 */

import { RATING_LEVELS, type RatingLevel } from "@/lib/staff/staff-rating";

/** One person's current level tagged with their role, for per-role averages. */
export type RatingStatRow = {
  role: string;
  level: number | null;
};

/** Headcount at a single level, for the distribution bar chart. */
export type LevelCount = { level: RatingLevel; count: number };

/** A role plus its average level (null when nobody in the role is rated). */
export type RoleAverageLevel = {
  role: string;
  averageLevel: number | null;
  ratedCount: number;
};

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** How many people sit at each level L0–L4 (unrated excluded), in level order. */
export function computeLevelDistribution(
  levels: readonly (number | null)[],
): LevelCount[] {
  return RATING_LEVELS.map((level) => ({
    level,
    count: levels.filter((l) => l === level).length,
  }));
}

/** How many people are unrated (level is null). */
export function countUnrated(levels: readonly (number | null)[]): number {
  return levels.filter((l) => l == null).length;
}

/**
 * The average level over RATED people only (unrated excluded), or `null` when
 * nobody is rated. A raw mean — format with `formatAverageLevel`.
 */
export function computeAverageLevel(
  levels: readonly (number | null)[],
): number | null {
  return mean(levels.filter((l): l is number => l != null));
}

/**
 * Average level per role, emitted in `roleOrder` and skipping any role with no
 * people at all. Each role's average is over its RATED members only (`null` when
 * none are rated), with the rated headcount alongside.
 */
export function computeAverageLevelByRole(
  rows: readonly RatingStatRow[],
  roleOrder: readonly string[],
): RoleAverageLevel[] {
  return roleOrder
    .map((role) => rows.filter((r) => r.role === role))
    .filter((group) => group.length > 0)
    .map((group) => {
      const rated = group
        .map((r) => r.level)
        .filter((l): l is number => l != null);
      return {
        role: group[0].role,
        averageLevel: mean(rated),
        ratedCount: rated.length,
      };
    });
}
