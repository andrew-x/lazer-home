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
 *
 * **`table-fixed` only binds on a table with an explicit `width`.** With
 * `width: auto` the browser silently falls back to the *automatic* table
 * algorithm, where the classes below degrade to mere preferences and the widest
 * content in *any* row wins — so a grid whose rows expand (the by-project
 * allocations view) visibly reflows its columns when you open a row, because the
 * `truncate` label cells contribute their full un-clipped `nowrap` text. Hence
 * the `*_REM` twins: a grid sums them into an inline `width` on the `<table>`.
 * Keep each pair in lockstep — if a number drifts from its class, fixed layout
 * redistributes the difference and every column is quietly off.
 */

import type { Granularity } from "@/lib/allocations/allocations-grid";

/** Primary label column — the staff name (allocations) / role (planner). */
export const PLANNER_LABEL_COL = "w-56 min-w-56 max-w-56";

/** {@link PLANNER_LABEL_COL} in rem (`w-56` = 14rem). */
export const PLANNER_LABEL_COL_REM = 14;

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

/** {@link PLANNER_COLUMN_WIDTH} in rem (`w-24`/`w-28`/`w-32`). */
export const PLANNER_COLUMN_WIDTH_REM: Record<Granularity, number> = {
  day: 6,
  week: 7,
  month: 8,
};

/**
 * The inline `width` a granularity-aware grid must put on its `<table>` for
 * `table-fixed` to take effect at all — the label column plus one bucket column
 * per `columnCount`. Without it the column widths depend on the rows' contents,
 * so they shift as rows expand or the data changes.
 */
export function plannerTableWidth(
  granularity: Granularity,
  columnCount: number,
): { width: string } {
  const rem =
    PLANNER_LABEL_COL_REM + columnCount * PLANNER_COLUMN_WIDTH_REM[granularity];
  return { width: `${rem}rem` };
}

/** The noun a planner cell's percentage is "% of", by granularity. */
export const PLANNER_UNIT_NOUN: Record<Granularity, string> = {
  day: "day",
  week: "week",
  month: "month",
};
