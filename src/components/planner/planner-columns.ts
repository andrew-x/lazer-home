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

/** Primary label column — the staff name (allocations) / role (planner). */
export const PLANNER_LABEL_COL = "w-56 min-w-56 max-w-56";

/** The planner's secondary label column — its Staff sub-column. */
export const PLANNER_SUB_LABEL_COL = "w-48 min-w-48 max-w-48";

/** One week / time-range column. Fixed so every column is identical. */
export const PLANNER_WEEK_COL = "w-28 min-w-28 max-w-28";
