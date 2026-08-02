/**
 * Shared column widths for the week-based planner grids — the allocations grid,
 * the opportunity project plan, and the project detail view. Centralised here so
 * every planner lines its columns up to the same widths.
 *
 * These are literal Tailwind class strings (not built dynamically) so the
 * compiler still sees the utilities. The grids use `table-fixed`, which makes
 * these widths authoritative: overlong content is clipped (with `truncate` on
 * the label cells) rather than allowed to stretch a column, and the week columns
 * stay a uniform width regardless of how many weeks are shown.
 */

import type { Granularity } from "@/lib/allocations/allocations-grid";

/** Primary label column — the staff name (allocations) / role (planner). */
export const PLANNER_LABEL_COL = "w-56 min-w-56 max-w-56";

/** The planner's secondary label column — its Staff sub-column. */
export const PLANNER_SUB_LABEL_COL = "w-48 min-w-48 max-w-48";

/** One week / time-range column. Fixed so every column is identical. */
export const PLANNER_WEEK_COL = "w-28 min-w-28 max-w-28";

/**
 * Column width per granularity for the day/week/month planners — days pack
 * tighter, months breathe. The week bucket reuses {@link PLANNER_WEEK_COL} so the
 * granularity-aware grids still line up with the week-only ones. Shared by both
 * allocations views (staff rows and project rows) so a column is the same width
 * whichever way you're looking at the same data.
 */
export const PLANNER_COLUMN_WIDTH: Record<Granularity, string> = {
  day: "w-24 min-w-24 max-w-24",
  week: PLANNER_WEEK_COL,
  month: "w-32 min-w-32 max-w-32",
};

/** The noun a planner cell's percentage is "% of", by granularity. */
export const PLANNER_UNIT_NOUN: Record<Granularity, string> = {
  day: "day",
  week: "week",
  month: "month",
};
