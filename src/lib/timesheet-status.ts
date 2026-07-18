/**
 * The timesheet lifecycle status. Declared here as a pure, client-importable
 * module (no `db`/drizzle) so the `timesheetStatusEnum` pgEnum in
 * `timesheets-schema.ts`, the read types, and the UI labels all share exactly
 * one source of truth. A timesheet starts `draft` and moves to `submitted` when
 * the week is turned in (approval is the next planned slice). See
 * docs/domains/timesheets.md.
 */
export const TIMESHEET_STATUSES = ["draft", "submitted"] as const;

export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

/** The status a timesheet is created with by default. */
export const DEFAULT_TIMESHEET_STATUS: TimesheetStatus = "draft";

/** Human-readable labels for each timesheet status. */
export const TIMESHEET_STATUS_LABELS: Record<TimesheetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
};
