/**
 * The editor's column headers, in order. Declared once so the header row and the
 * expanded panel's `colSpan` can never drift apart — a mismatch there silently
 * breaks the table layout.
 *
 * The leading entry is the expand chevron; the trailing one carries the
 * Rippling-drift badge on a committed plan. Both are intentionally unlabelled
 * but still occupy a column.
 */
export const PLAN_COLUMNS = [
  { key: "expand", label: "", align: "left" },
  { key: "name", label: "Name", align: "left" },
  { key: "rating", label: "Rating", align: "left" },
  { key: "current", label: "Current", align: "left" },
  { key: "planned", label: "Planned", align: "left" },
  { key: "changeAmount", label: "Change", align: "left" },
  { key: "changePercent", label: "Change %", align: "left" },
  { key: "ratingDone", label: "Rating done", align: "left" },
  { key: "meetingDone", label: "Meeting done", align: "left" },
  { key: "complete", label: "Complete", align: "left" },
  { key: "applied", label: "", align: "left" },
] as const;

export const PLAN_COLUMN_COUNT = PLAN_COLUMNS.length;
