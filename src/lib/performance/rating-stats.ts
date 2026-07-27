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

import {
  rubricForRole,
  type Subratings,
} from "@/lib/performance/rating-rubric";
import type { Role } from "@/lib/staff/staff-enums";
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

/** One person's current subratings tagged with their role, for the averages. */
export type SubratingStatRow = {
  role: string;
  subratings: Subratings | null;
};

/** A rubric category's average subrating (null when nobody scored it). */
export type SubratingCategoryAverage = {
  key: string;
  label: string;
  average: number | null;
  ratedCount: number;
};

/** A role plus the average of each of its rubric categories. */
export type RoleSubratingAverages = {
  role: string;
  categories: SubratingCategoryAverage[];
};

/**
 * Average subrating per rubric category, grouped by role — for the dashboard's
 * anonymized subratings breakdown. Only roles with a rubric are considered, and
 * a role is emitted only when at least one of its categories has been scored, so
 * roles/categories with no data don't clutter the view. Each category's average
 * is over the people who have that category set; format with `formatAverageLevel`.
 */
export function computeAverageSubratingsByRole(
  rows: readonly SubratingStatRow[],
  roleOrder: readonly string[],
): RoleSubratingAverages[] {
  return roleOrder
    .map((role) => ({ role, rubric: rubricForRole(role as Role) }))
    .filter(({ rubric }) => rubric.length > 0)
    .map(({ role, rubric }) => {
      const roleRows = rows.filter((r) => r.role === role);
      const categories = rubric.map((category) => {
        const values = roleRows
          .map((r) => r.subratings?.[category.key])
          .filter((v): v is number => v != null);
        return {
          key: category.key,
          label: category.label,
          average: mean(values),
          ratedCount: values.length,
        };
      });
      return { role, categories };
    })
    .filter((r) => r.categories.some((c) => c.ratedCount > 0));
}
