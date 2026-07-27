import "server-only";

import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import { DAILY_HOUR_CAP } from "@/actions/timesheets/saveTimesheet.schema";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { companies, projectRoles, projects, staffPto } from "@/lib/db/schema";
import { getWeekDays, isWeekend } from "@/lib/timesheets/timesheet-week";

/** A project the person is allocated to this week, with planned hours per day. */
export type AllocatedProject = {
  projectId: string;
  name: string;
  companyName: string;
  /** Weekday ISO date → planned hours (weekends and off-span days omitted). */
  hoursByDate: Record<string, number>;
};

/**
 * Everything needed to *suggest* and *prefill* a week's timesheet: the projects
 * the person is planned onto (from their allocations) and the weekdays they have
 * approved leave. Both are one-way conveniences — the user opts in via buttons;
 * nothing is written until they save.
 */
export type TimesheetPrefill = {
  allocations: AllocatedProject[];
  /** Weekday ISO date → PTO hours (a full working day per approved off-day). */
  ptoHoursByDate: Record<string, number>;
};

const EMPTY: TimesheetPrefill = { allocations: [], ptoHoursByDate: {} };

/**
 * Allocation + approved-PTO prefill data for a staff member's week (keyed by its
 * ISO-Monday `weekStartDate`).
 *
 * Authorization mirrors `getTimesheet`: a user always sees their OWN prefill;
 * reading another person's requires the `timesheets.edit` capability
 * (manager/admin), else an empty prefill is returned. Only leave *dates* are
 * read here — never the PTO `type` (that disclosure is gated behind
 * `pto:["review"]`), so this stays within the permissions model.
 */
export async function getTimesheetPrefill(
  staffId: string,
  weekStartDate: string,
): Promise<TimesheetPrefill> {
  const ownStaffId = await getCurrentStaffId();
  if (staffId !== ownStaffId) {
    const user = await getCurrentUser();
    if (!user || !userHasPermission(user, { timesheets: ["edit"] }))
      return EMPTY;
  }

  const weekDays = getWeekDays(weekStartDate);
  const workdays = weekDays.filter((d) => !isWeekend(d));
  const weekEnd = weekDays[weekDays.length - 1];

  // Staffed, live (tentative/confirmed) roles for this person overlapping the
  // week. Overlap = role starts on/before the week ends AND ends on/after it
  // starts (ISO date strings compare lexicographically).
  const roleRows = await db
    .select({
      projectId: projectRoles.projectId,
      projectName: projects.name,
      companyName: companies.name,
      status: projectRoles.status,
      startDate: projectRoles.startDate,
      endDate: projectRoles.endDate,
      hoursPerDay: projectRoles.hoursPerDay,
    })
    .from(projectRoles)
    .innerJoin(projects, eq(projectRoles.projectId, projects.id))
    .innerJoin(companies, eq(projects.companyId, companies.id))
    .where(
      and(
        eq(projectRoles.staffId, staffId),
        inArray(projectRoles.status, ["tentative", "confirmed"]),
        lte(projectRoles.startDate, weekEnd),
        gte(projectRoles.endDate, weekStartDate),
      ),
    )
    .orderBy(asc(projects.name));

  // Fold roles into one entry per project, summing overlapping roles per day and
  // clamping each day to the 8h cap so a prefill never lands over-cap on its own.
  const byProject = new Map<string, AllocatedProject>();
  for (const role of roleRows) {
    let alloc = byProject.get(role.projectId);
    if (!alloc) {
      alloc = {
        projectId: role.projectId,
        name: role.projectName,
        companyName: role.companyName,
        hoursByDate: {},
      };
      byProject.set(role.projectId, alloc);
    }
    for (const date of workdays) {
      if (date < role.startDate || date > role.endDate) continue;
      const next = (alloc.hoursByDate[date] ?? 0) + role.hoursPerDay;
      alloc.hoursByDate[date] = Math.min(next, DAILY_HOUR_CAP);
    }
  }

  // Approved leave overlapping the week → a full working day per off weekday.
  const ptoRows = await db
    .select({
      startDate: staffPto.startDate,
      endDate: staffPto.endDate,
    })
    .from(staffPto)
    .where(
      and(
        eq(staffPto.staffId, staffId),
        eq(staffPto.isPending, false),
        lte(staffPto.startDate, weekEnd),
        gte(staffPto.endDate, weekStartDate),
      ),
    );

  const ptoHoursByDate: Record<string, number> = {};
  for (const pto of ptoRows) {
    for (const date of workdays) {
      if (date < pto.startDate || date > pto.endDate) continue;
      ptoHoursByDate[date] = DAILY_HOUR_CAP;
    }
  }

  return { allocations: [...byProject.values()], ptoHoursByDate };
}
