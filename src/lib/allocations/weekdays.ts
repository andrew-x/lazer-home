/**
 * Mon–Fri day counting over "YYYY-MM-DD" ranges — the shared primitive behind
 * every capacity figure in the app. Lifted out of `@/lib/allocations/allocations-grid`
 * when the home dashboard needed the same arithmetic for planned utilization and
 * availability; keeping one copy is what lets a week's planned *hours* and the
 * planner's displayed *percent* agree by construction.
 *
 * A client-importable module (no `db`/drizzle, no React). All bounds are inclusive
 * and compared as ISO strings, which sort lexicographically — see the database rule
 * on dates being wall-clock values.
 *
 * Caveat shared by everything here: there is no statutory-holiday calendar, so a
 * public holiday counts as working capacity unless it was recorded as leave
 * (`STATUTORY_HOLIDAY` in `staff_pto`). Surfaces that show capacity say so.
 */

import type { AllocationRoleRow } from "@/actions/allocations/getAllocationsGrid";
import { addDays, isWeekend } from "@/lib/timesheets/timesheet-week";

/** A dated span, inclusive at both ends — a PTO row, a role, a column. */
export type DateSpan = { startDate: string; endDate: string };

/** Count of Mon–Fri days in `[from, to]` that also fall within `[spanStart, spanEnd]`. */
export function activeWeekdays(
  from: string,
  to: string,
  spanStart: string,
  spanEnd: string,
): number {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (isWeekend(day)) continue;
    if (day >= spanStart && day <= spanEnd) count += 1;
  }
  return count;
}

/** Count of Mon–Fri days in `[from, to]` — the bucket's full working capacity. */
export function totalWeekdays(from: string, to: string): number {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (!isWeekend(day)) count += 1;
  }
  return count;
}

/** Mon–Fri days in `[from, to]` covered by any of the `spans` (overlaps deduped). */
export function awayWeekdays(
  from: string,
  to: string,
  spans: readonly DateSpan[],
): number {
  let count = 0;
  for (let day = from; day <= to; day = addDays(day, 1)) {
    if (isWeekend(day)) continue;
    if (spans.some((span) => day >= span.startDate && day <= span.endDate)) {
      count += 1;
    }
  }
  return count;
}

/**
 * The latest end date across a person's **confirmed** roles, or null when they
 * have none. This is "when they next free up" — the key the allocations planner
 * sorts on to surface available people first, and the same rule the home
 * dashboard's bench list uses. Only confirmed roles count: a purely tentative
 * allocation doesn't commit the person.
 */
export function latestConfirmedEnd(
  personRoles: readonly Pick<AllocationRoleRow, "status" | "endDate">[],
): string | null {
  let latest: string | null = null;
  for (const role of personRoles) {
    if (role.status !== "confirmed") continue;
    if (latest === null || role.endDate > latest) latest = role.endDate;
  }
  return latest;
}
