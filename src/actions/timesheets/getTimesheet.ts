import "server-only";

import { and, asc, eq } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { companies, projects, timeEntries, timesheets } from "@/lib/db/schema";
import type { TimesheetCategory } from "@/lib/timesheets/timesheet-category";
import type { TimesheetStatus } from "@/lib/timesheets/timesheet-status";

/** One logged row, with the project/company names resolved for display. */
export type TimesheetEntryView = {
  id: string;
  date: string;
  projectId: string | null;
  projectName: string | null;
  companyName: string | null;
  category: TimesheetCategory | null;
  hours: number;
};

export type TimesheetView = {
  status: TimesheetStatus;
  submittedAt: Date | null;
  entries: TimesheetEntryView[];
};

/**
 * A staff member's timesheet for one week (keyed by its ISO-Monday
 * `weekStartDate`), with entries joined to project/company names.
 *
 * Authorization: a user always sees their OWN timesheet; viewing another
 * person's requires the `timesheets.edit` capability (manager/admin), else
 * returns `null` so the page can hide it rather than error. A week with no saved
 * timesheet returns an empty draft (distinct from `null` = not permitted).
 */
export async function getTimesheet(
  staffId: string,
  weekStartDate: string,
): Promise<TimesheetView | null> {
  const ownStaffId = await getCurrentStaffId();
  if (staffId !== ownStaffId) {
    const user = await getCurrentUser();
    if (!user || !userHasPermission(user, { timesheets: ["edit"] }))
      return null;
  }

  const [sheet] = await db
    .select({
      id: timesheets.id,
      status: timesheets.status,
      submittedAt: timesheets.submittedAt,
    })
    .from(timesheets)
    .where(
      and(
        eq(timesheets.staffId, staffId),
        eq(timesheets.weekStartDate, weekStartDate),
      ),
    )
    .limit(1);

  if (!sheet) return { status: "draft", submittedAt: null, entries: [] };

  const rows = await db
    .select({
      id: timeEntries.id,
      date: timeEntries.date,
      projectId: timeEntries.projectId,
      category: timeEntries.category,
      hours: timeEntries.hours,
      projectName: projects.name,
      companyName: companies.name,
    })
    .from(timeEntries)
    .leftJoin(projects, eq(timeEntries.projectId, projects.id))
    .leftJoin(companies, eq(projects.companyId, companies.id))
    .where(eq(timeEntries.timesheetId, sheet.id))
    .orderBy(asc(timeEntries.date));

  return {
    status: sheet.status,
    submittedAt: sheet.submittedAt,
    entries: rows,
  };
}
