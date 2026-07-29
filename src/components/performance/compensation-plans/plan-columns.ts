import type { PlanSortKey } from "./plan-view";

/**
 * The editor's column headers, in order. Declared once so the header row, each
 * column's sortability and alignment, and the expanded panel's `colSpan` can never
 * drift apart — a `colSpan` mismatch silently breaks the table layout.
 *
 * The leading entry is the expand chevron; the trailing one carries the
 * Rippling-drift badge on a committed plan. Both are intentionally unlabelled but
 * still occupy a column, and neither sorts.
 *
 * There is deliberately no Hub/Global column: it lives in the name sub-line, and
 * grouping by it is what the toolbar filter is for. A sort key with no header to
 * click would be dead code.
 */

export type PlanColumn = {
  key: string;
  label: string;
  /** Present ⇒ the header is a sort button for this key. */
  sort?: PlanSortKey;
  /** Right-aligned and tabular — the repo's rule for number cells. */
  numeric?: true;
};

// Annotated rather than `as const`: the header needs to read `sort`/`numeric` off
// every entry uniformly, which a tuple of narrowed literal types won't allow.
export const PLAN_COLUMNS: readonly PlanColumn[] = [
  { key: "expand", label: "" },
  { key: "name", label: "Name", sort: "name" },
  { key: "rating", label: "Rating", sort: "rating" },
  { key: "current", label: "Current", sort: "current", numeric: true },
  // Planned holds an input, so it stays left-aligned despite being a money column.
  { key: "planned", label: "Planned", sort: "planned" },
  {
    key: "changeAmount",
    label: "Change",
    sort: "changeAmount",
    numeric: true,
  },
  {
    key: "changePercent",
    label: "Change %",
    sort: "changePercent",
    numeric: true,
  },
  { key: "gapAmount", label: "Gap", sort: "gapAmount", numeric: true },
  { key: "gapPercent", label: "Gap %", sort: "gapPercent", numeric: true },
  { key: "status", label: "Status", sort: "status" },
  { key: "applied", label: "" },
];

export const PLAN_COLUMN_COUNT = PLAN_COLUMNS.length;

/**
 * The shared class for a numeric cell. Applied by the cells directly and mirrored
 * onto the header off each column's `numeric` flag, so a column can't be
 * right-aligned in one place and not the other.
 */
export const PLAN_NUMERIC_CELL = "text-right tabular-nums whitespace-nowrap";
