import { z } from "zod";
import { formatIsoDate, parseIsoDate } from "@/lib/format";

/**
 * A calendar date as a timezone-agnostic "YYYY-MM-DD" string (the DatePicker's
 * output and the DB's `date()` wall-clock format). The shared primitive so every
 * schema validates the same shape with the same message — the date counterpart to
 * `id`/`idList`. See `.claude/rules/database.md` on dates being wall-clock values.
 */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True only for a real calendar date in "YYYY-MM-DD" form. A format-only regex
 * accepts impossible dates (e.g. 2026-02-30, 2025-02-29), which then roll over
 * when parsed. Round-tripping through the drift-safe parse/format pair rejects
 * them: an out-of-range day/month normalizes to a different date, so the
 * formatted result no longer equals the input. (Shared with the timesheet week
 * guard — see `(app)/timesheets/[week]/page.tsx`.)
 */
export function isCalendarDate(value: string): boolean {
  return ISO_DATE.test(value) && formatIsoDate(parseIsoDate(value)) === value;
}

export const dateString = z
  .string()
  .refine(isCalendarDate, "Pick a valid date.");
