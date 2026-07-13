import { z } from "zod";
import { TIMESHEET_CATEGORY } from "@/lib/timesheet-category";
import { getWeekDays, getWeekStart, isWeekend } from "@/lib/timesheet-week";

/**
 * Save-timesheet input. A pure, client-importable module (no `db`/drizzle) so the
 * weekly-grid form's resolver and the server action share exactly one set of
 * rules. Category values come from `@/lib/timesheet-category` — the same source
 * the pgEnum is built from. See docs/domains/timesheets.md.
 */

/** The per-day hour ceiling — total across all rows for a single day. */
export const DAILY_HOUR_CAP = 8;

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a valid date.");

/**
 * A single logged row: hours on one day against EITHER a project (billable) OR a
 * non-billable category — exactly one target. Zero-hour rows are allowed here
 * (an empty grid cell) and dropped by the action before persisting.
 */
export const timeEntryInputSchema = z
  .object({
    date: dateString,
    projectId: z.string().min(1).nullish(),
    category: z.enum(TIMESHEET_CATEGORY).nullish(),
    hours: z.coerce
      .number()
      .min(0, "Hours can't be negative.")
      .max(
        DAILY_HOUR_CAP,
        `A single entry can't exceed ${DAILY_HOUR_CAP} hours.`,
      ),
  })
  .refine((e) => (e.projectId != null) !== (e.category != null), {
    message: "An entry must target either a project or a category.",
  });

export const saveTimesheetSchema = z
  .object({
    staffId: z.string().min(1),
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
    const hoursByDay = new Map<string, number>();
    const seen = new Set<string>();

    val.entries.forEach((entry, index) => {
      if (!weekDays.has(entry.date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Date is outside this week.",
          path: ["entries", index, "date"],
        });
      } else if (isWeekend(entry.date)) {
        // Timesheets only capture weekday work (weekend cells are disabled).
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Hours can't be logged on weekends.",
          path: ["entries", index, "date"],
        });
      }

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

      hoursByDay.set(
        entry.date,
        (hoursByDay.get(entry.date) ?? 0) + entry.hours,
      );
    });

    for (const [date, total] of hoursByDay) {
      if (total > DAILY_HOUR_CAP) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${date}: ${total}h exceeds the ${DAILY_HOUR_CAP}h daily cap.`,
          path: ["entries"],
        });
      }
    }
  });

export type SaveTimesheetInput = z.input<typeof saveTimesheetSchema>;
