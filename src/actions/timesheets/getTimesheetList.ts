import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db/db";
import { timeEntries, timesheets } from "@/lib/db/schema";
import { userHasPermission } from "@/lib/permissions";
import { addWeeks, currentWeekStart } from "@/lib/timesheet-week";

/** One week in the browse list, with its logged total and lifecycle state. */
export type TimesheetListRow = {
  weekStartDate: string;
  status: "draft" | "submitted";
  totalHours: number;
  /** False for a week that has no timesheet row yet ("Not started"). */
  started: boolean;
};

/**
 * A staff member's timesheets for browsing, newest week first. Every week that
 * has a record is included with its summed hours; the current, previous, and
 * next weeks are always present (even before they're started) so the actionable
 * ±1-week window is never missing from the list.
 *
 * Authorization mirrors `getTimesheet`: a user always sees their OWN list;
 * viewing another person's requires the `timesheets.edit` capability
 * (manager/admin), else returns an empty list so the page hides it rather than
 * leaking another person's weeks.
 */
export async function getTimesheetList(
  staffId: string,
): Promise<TimesheetListRow[]> {
  const ownStaffId = await getCurrentStaffId();
  if (staffId !== ownStaffId) {
    const user = await getCurrentUser();
    if (!user || !userHasPermission(user, { timesheets: ["edit"] })) return [];
  }

  const existing = await db
    .select({
      weekStartDate: timesheets.weekStartDate,
      status: timesheets.status,
      totalHours: sql<number>`coalesce(sum(${timeEntries.hours}), 0)`.mapWith(
        Number,
      ),
    })
    .from(timesheets)
    .leftJoin(timeEntries, eq(timeEntries.timesheetId, timesheets.id))
    .where(eq(timesheets.staffId, staffId))
    .groupBy(timesheets.id)
    .orderBy(desc(timesheets.weekStartDate));

  const byWeek = new Map<string, TimesheetListRow>(
    existing.map((r) => [r.weekStartDate, { ...r, started: true }]),
  );

  // Guarantee the editable window is browsable even when not yet started.
  const cw = currentWeekStart();
  for (const week of [addWeeks(cw, 1), cw, addWeeks(cw, -1)]) {
    if (!byWeek.has(week)) {
      byWeek.set(week, {
        weekStartDate: week,
        status: "draft",
        totalHours: 0,
        started: false,
      });
    }
  }

  return [...byWeek.values()].sort((a, b) =>
    a.weekStartDate < b.weekStartDate ? 1 : -1,
  );
}
