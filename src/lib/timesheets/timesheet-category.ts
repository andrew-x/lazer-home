/**
 * Non-billable time categories. Declared here as a pure, client-importable module
 * (no `db`/drizzle) so the `timeEntryCategoryEnum` pgEnum in `timesheets-schema.ts`,
 * zod schemas, and client forms all share exactly one source of truth — mirrors
 * `@/lib/crm/line-of-business`.
 *
 * A time entry logs hours against either a project (billable) or one of these
 * buckets (non-billable). The PTO bucket here is independent of the `staff_pto`
 * table — it's just a place to record hours, with no sync between the two.
 */
export const TIMESHEET_CATEGORY = [
  "PTO",
  "UNALLOCATED_BENCH",
  "INTERNAL_ADMIN",
] as const;

export type TimesheetCategory = (typeof TIMESHEET_CATEGORY)[number];

/** Human-readable labels for each non-billable category. */
export const TIMESHEET_CATEGORY_LABELS: Record<TimesheetCategory, string> = {
  PTO: "PTO",
  UNALLOCATED_BENCH: "Unallocated Bench Time",
  INTERNAL_ADMIN: "Internal Admin Work",
};
