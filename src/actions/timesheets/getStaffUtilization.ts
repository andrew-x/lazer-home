import "server-only";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import {
  projectRoles,
  staffPto,
  timeEntries,
  timesheets,
} from "@/lib/db/schema";
import type { TimesheetCategory } from "@/lib/timesheets/timesheet-category";
import {
  buildPlanRow,
  type HoursRow,
  type PlanRow,
} from "@/lib/timesheets/utilization";

/** Typed so dropping the category from the enum fails the build, not the query. */
const PTO: TimesheetCategory = "PTO";

export type StaffUtilization = {
  /** The elapsed year measured: 1 January through today. */
  rangeStart: string;
  rangeEnd: string;
  /** Null when the person has logged no timesheet this year — absent, not zero. */
  hours: HoursRow | null;
  plan: PlanRow;
  /** Timesheet weeks with any hours on them — the coverage disclosure. */
  weeksLogged: number;
};

/**
 * One person's year-to-date utilization inputs. The arithmetic lives in
 * `@/lib/timesheets/utilization`, which documents both rates and why their
 * denominators differ; this read is a projection.
 *
 * **Nothing looks forward.** Timesheets are bounded to weeks that have started,
 * and the plan range stops at `rangeEnd` (today), so a role booked for November
 * contributes only the weekdays of it that have already passed.
 *
 * The hour buckets reuse the structural-billability CASE sums from
 * `getTimesheetList`: an entry targets either a project (billable) or a category
 * (not), never both. Draft timesheets are included — the current week's is nearly
 * always a draft, and most unsubmitted weeks are too.
 *
 * Authorization mirrors `getTimesheetList`: a user always sees their OWN figures;
 * anyone else's needs `timesheets.edit` (manager/admin), else the hours come back
 * null so the surface shows "—" rather than leaking another person's year.
 */
export async function getStaffUtilization(
  staffId: string,
  rangeStart: string,
  rangeEnd: string,
): Promise<StaffUtilization> {
  const empty: StaffUtilization = {
    rangeStart,
    rangeEnd,
    hours: null,
    plan: buildPlanRow([], [], rangeStart, rangeEnd),
    weeksLogged: 0,
  };

  const ownStaffId = await getCurrentStaffId();
  if (staffId !== ownStaffId) {
    const user = await getCurrentUser();
    if (!user || !userHasPermission(user, { timesheets: ["edit"] })) {
      return empty;
    }
  }

  const [hourRows, roleRows, ptoRows] = await Promise.all([
    db
      .select({
        projectHours:
          sql<number>`coalesce(sum(case when ${timeEntries.projectId} is not null then ${timeEntries.hours} else 0 end), 0)`.mapWith(
            Number,
          ),
        ptoHours:
          sql<number>`coalesce(sum(case when ${timeEntries.category}::text = ${PTO} then ${timeEntries.hours} else 0 end), 0)`.mapWith(
            Number,
          ),
        totalHours: sql<number>`coalesce(sum(${timeEntries.hours}), 0)`.mapWith(
          Number,
        ),
        weeksLogged: sql<number>`count(distinct ${timesheets.id})`.mapWith(
          Number,
        ),
      })
      .from(timesheets)
      .leftJoin(timeEntries, eq(timeEntries.timesheetId, timesheets.id))
      .where(
        and(
          eq(timesheets.staffId, staffId),
          gte(timesheets.weekStartDate, rangeStart),
          lte(timesheets.weekStartDate, rangeEnd),
        ),
      ),

    db
      .select({
        status: projectRoles.status,
        startDate: projectRoles.startDate,
        endDate: projectRoles.endDate,
        hoursPerDay: projectRoles.hoursPerDay,
      })
      .from(projectRoles)
      .where(
        and(
          eq(projectRoles.staffId, staffId),
          inArray(projectRoles.status, ["tentative", "confirmed"]),
          lte(projectRoles.startDate, rangeEnd),
          gte(projectRoles.endDate, rangeStart),
        ),
      ),

    db
      .select({
        startDate: staffPto.startDate,
        endDate: staffPto.endDate,
      })
      .from(staffPto)
      .where(
        and(
          eq(staffPto.staffId, staffId),
          eq(staffPto.isPending, false),
          lte(staffPto.startDate, rangeEnd),
          gte(staffPto.endDate, rangeStart),
        ),
      ),
  ]);

  // One ungrouped aggregate row always comes back; zero weeks means no timesheets.
  const totals = hourRows[0];
  return {
    rangeStart,
    rangeEnd,
    hours:
      totals && totals.weeksLogged > 0
        ? {
            projectHours: totals.projectHours,
            ptoHours: totals.ptoHours,
            totalHours: totals.totalHours,
          }
        : null,
    plan: buildPlanRow(roleRows, ptoRows, rangeStart, rangeEnd),
    weeksLogged: totals?.weeksLogged ?? 0,
  };
}
