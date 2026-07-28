import { z } from "zod";
import { dateString } from "@/lib/schemas/date-schema";
import { id } from "@/lib/schemas/id-schema";
import type { EmploymentType } from "@/lib/staff/staff-enums";
import { TIMESHEET_CATEGORY } from "@/lib/timesheets/timesheet-category";
import { getWeekDays, getWeekStart } from "@/lib/timesheets/timesheet-week";

/**
 * Save-timesheet input. A pure, client-importable module (no `db`/drizzle) so the
 * weekly-grid form's resolver and the server action share exactly one set of
 * rules. Category values come from `@/lib/timesheets/timesheet-category` — the same source
 * the pgEnum is built from. See docs/domains/timesheets.md.
 */

/**
 * The standard full day / full week. Going OVER either is a soft warning: a day
 * over `DAILY_HOUR_CAP` or a week over `WEEKLY_HOUR_CAP` still saves and submits
 * — the grid just warns that it will be flagged for manager / delivery-manager
 * review. They drive the warning thresholds and the autofill ceiling, never
 * `saveTimesheet` validation.
 *
 * `WEEKLY_HOUR_CAP` doubles as a FLOOR on submission: a full-time person must
 * account for all 40 hours (project, non-billable, or PTO) before they can submit
 * the week — enforced in `submitTimesheet`, see {@link requiresFullWeek}. Saving
 * a short draft is always allowed.
 */
export const DAILY_HOUR_CAP = 8;
export const WEEKLY_HOUR_CAP = 40;

/**
 * Whether this person must account for a full `WEEKLY_HOUR_CAP` week before
 * submitting. Full-time staff do; hourly staff legitimately work short weeks, so
 * they see the "unaccounted hours" nudge without the block. An unknown
 * employment type (no `staff_employment` row yet) is not gated.
 */
export function requiresFullWeek(
  employmentType: EmploymentType | null,
): boolean {
  return employmentType === "FULL_TIME";
}

/** Hard ceiling on a single entry's hours — a physical day. */
export const MAX_ENTRY_HOURS = 24;

/**
 * A single logged row: hours on one day against EITHER a project (billable) OR a
 * non-billable category — exactly one target. Zero-hour rows are allowed here
 * (an empty grid cell) and dropped by the action before persisting.
 */
export const timeEntryInputSchema = z
  .object({
    date: dateString,
    projectId: id.nullish(),
    category: z.enum(TIMESHEET_CATEGORY).nullish(),
    hours: z.coerce
      .number()
      .min(0, "Hours can't be negative.")
      .max(
        MAX_ENTRY_HOURS,
        `A single entry can't exceed ${MAX_ENTRY_HOURS} hours.`,
      ),
  })
  .refine((e) => (e.projectId != null) !== (e.category != null), {
    message: "An entry must target either a project or a category.",
  });

export const saveTimesheetSchema = z
  .object({
    staffId: id,
    weekStartDate: dateString,
    entries: z.array(timeEntryInputSchema).max(200, "Too many rows."),
  })
  .superRefine((val, ctx) => {
    // The week must be keyed by its ISO Monday.
    if (getWeekStart(val.weekStartDate) !== val.weekStartDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Week must start on a Monday.",
        path: ["weekStartDate"],
      });
      return;
    }

    const weekDays = new Set(getWeekDays(val.weekStartDate));
    const seen = new Set<string>();

    val.entries.forEach((entry, index) => {
      if (!weekDays.has(entry.date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Date is outside this week.",
          path: ["entries", index, "date"],
        });
      }
      // Weekend hours ARE allowed now — the grid flags them for review rather
      // than rejecting them (like the soft daily/weekly thresholds).

      // One row per (day, target). `projectId` and `category` are mutually
      // exclusive (refined above), so either uniquely identifies the target.
      const target = entry.projectId ?? `category:${entry.category}`;
      const key = `${entry.date}|${target}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate row for this day and target.",
          path: ["entries", index],
        });
      }
      seen.add(key);
    });

    // NOTE: a day over DAILY_HOUR_CAP or a week over WEEKLY_HOUR_CAP is allowed
    // (the grid warns it'll be flagged for review) — no hard total cap here.
  });

export type SaveTimesheetInput = z.input<typeof saveTimesheetSchema>;
