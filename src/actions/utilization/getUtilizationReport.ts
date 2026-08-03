import "server-only";

import {
  and,
  asc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  min,
  or,
} from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { firstPerKey } from "@/lib/core/collections";
import { db } from "@/lib/db/db";
import {
  projectRoles,
  staff,
  staffEmployment,
  staffPto,
  timeEntries,
  timesheets,
} from "@/lib/db/schema";
import { ROLE_STATUS } from "@/lib/projects/project-role-status";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { STAFF_FILTER_OPTIONS } from "@/lib/staff/staff-filters";
import { eachWeek } from "@/lib/timesheets/timesheet-week";
import type {
  UtilizationEntry,
  UtilizationPtoRecord,
  UtilizationRange,
  UtilizationRole,
  UtilizationStaff,
  UtilizationWeek,
} from "@/lib/utilization/utilization-report";

/**
 * Filter dimensions for the utilization report, re-exported so the page passes
 * them as props without importing the Drizzle schema (the actions layer owns all
 * `@/lib/db` access). `lineOfBusiness` filters the cohort; `role` and
 * `employmentType` filter the two per-person tables.
 */
export const utilizationFilterOptions = STAFF_FILTER_OPTIONS;

export type UtilizationReportData = {
  range: UtilizationRange;
  staff: UtilizationStaff[];
  roles: UtilizationRole[];
  pto: UtilizationPtoRecord[];
  entries: UtilizationEntry[];
  weeks: UtilizationWeek[];
  firstRoleStartByStaff: Record<string, string>;
  /**
   * Whether the viewer may read the cohort's logged (timesheet) hours — see the
   * disclosure note on {@link getUtilizationReport}. The single signal for the
   * gate: the client derives every "may I see this" decision from it, including
   * whether to offer the report's Logged basis at all, rather than from a second
   * flag that could disagree.
   */
  canViewLogged: boolean;
};

/**
 * The raw material for the utilization report: everyone employed for any part of
 * the window with their current employment facts, the staffed role spans and
 * approved PTO overlapping it, and the time entries behind the confirmed series.
 * All bucketing,
 * day-splitting and percentages are pure client math
 * (`@/lib/utilization/utilization-report`), so this read stays a projection.
 *
 * **No metadata gate on the report as a whole.** The `(app)` layout guarantees
 * the viewer is signed in, and the planned series is a re-aggregation of what
 * `getAllocationsGrid` already discloses openly to every signed-in user: staffed
 * role spans, `hoursPerDay`, line of business, and approved PTO dates. PTO *type*
 * is deliberately not selected here — it is the one PTO field gated on
 * `pto.review`, and this report has no need for it.
 *
 * **The logged series is gated, cohort-wide.** Today no one can read another
 * person's logged hours: `getTimesheetList`/`getTimesheet` fail closed unless the
 * caller holds `timesheets.edit`. A cross-person actuals figure would be the first
 * such disclosure, so without that capability **no** timesheet row is read at all
 * and the report offers its Planned basis only — withheld in the read, never
 * shipped and hidden in the UI. Widening this audience means adding a
 * `timesheets.view` capability to the matrix, its test and the permissions doc in
 * lockstep — not loosening it here.
 */
export async function getUtilizationReport(
  range: UtilizationRange,
): Promise<UtilizationReportData> {
  const { start, end } = range;

  const currentUser = await getCurrentUser();
  const canViewLogged = currentUser
    ? userHasPermission(currentUser, { timesheets: ["edit"] })
    : false;

  // Everyone employed for any part of the window — NOT just currently-active
  // staff. The importer defines `isActive` as "has no termination date"
  // (`staff-import/transform.ts`), so filtering on it would make the departures
  // metric structurally zero and would drop a leaver's capacity, roles and logged
  // hours for the part of the period they were still here. Someone who left
  // before the window, or joins after it, is correctly excluded.
  const staffRows = await db
    .select({
      id: staff.id,
      name: staff.name,
      joinDate: staff.joinDate,
      terminationDate: staff.terminationDate,
    })
    .from(staff)
    .where(
      and(
        or(eq(staff.isActive, true), gte(staff.terminationDate, start)),
        or(isNull(staff.joinDate), lte(staff.joinDate, end)),
      ),
    )
    .orderBy(asc(staff.name));

  // Latest employment fact per person (effective-dating tiebreak, ADR 0007) —
  // one flat query folded in JS, no N+1, mirroring `getAllocationsGrid`.
  const employmentRows = await db
    .select({
      staffId: staffEmployment.staffId,
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
      isBillable: staffEmployment.isBillable,
    })
    .from(staffEmployment)
    .orderBy(...latestEmploymentFirst);
  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  // Staffed, confirmed roles only, overlapping the window. A placeholder has no
  // person to attribute time to; `tentative` is a forecast rather than an
  // allocation, and with no win probability in the schema to weight it by,
  // counting it only made every figure softer than it looked. `paused`/`cancelled`
  // were never allocations either.
  const roleRows = await db
    .select({
      id: projectRoles.id,
      staffId: projectRoles.staffId,
      projectId: projectRoles.projectId,
      lineOfBusiness: projectRoles.lineOfBusiness,
      startDate: projectRoles.startDate,
      endDate: projectRoles.endDate,
      hoursPerDay: projectRoles.hoursPerDay,
    })
    .from(projectRoles)
    .where(
      and(
        isNotNull(projectRoles.staffId),
        eq(projectRoles.status, ROLE_STATUS.confirmed),
        lte(projectRoles.startDate, end),
        gte(projectRoles.endDate, start),
      ),
    );

  // Approved leave only, and dates only — the leave *type* stays behind
  // `pto.review` and this report never needs it.
  const ptoRows = await db
    .select({
      staffId: staffPto.staffId,
      startDate: staffPto.startDate,
      endDate: staffPto.endDate,
    })
    .from(staffPto)
    .where(
      and(
        eq(staffPto.isPending, false),
        lte(staffPto.startDate, end),
        gte(staffPto.endDate, start),
      ),
    );

  // The earliest confirmed role per person over ALL time: the joiner
  // "days to first placement" metric needs a role that may predate the window,
  // so it cannot be read off `roleRows`.
  const firstRoleRows = await db
    .select({
      staffId: projectRoles.staffId,
      firstStart: min(projectRoles.startDate),
    })
    .from(projectRoles)
    .where(
      and(
        isNotNull(projectRoles.staffId),
        eq(projectRoles.status, ROLE_STATUS.confirmed),
      ),
    )
    .groupBy(projectRoles.staffId);

  // The logged series. Draft weeks are excluded: they're still being edited, so
  // counting them would make the number move under the reader.
  //
  // The gate is the absence of the query, not a post-filter: a viewer without
  // `timesheets.edit` never has a timesheet row in memory at all — not even their
  // own, because a cohort figure built from one person is not a cohort figure.
  const entryRows = !canViewLogged
    ? []
    : await db
        .select({
          staffId: timesheets.staffId,
          date: timeEntries.date,
          projectId: timeEntries.projectId,
          category: timeEntries.category,
          hours: timeEntries.hours,
        })
        .from(timeEntries)
        .innerJoin(timesheets, eq(timeEntries.timesheetId, timesheets.id))
        .where(
          and(
            eq(timesheets.status, "submitted"),
            gte(timeEntries.date, start),
            lte(timeEntries.date, end),
          ),
        );

  // Submitted-week coverage, under the same gate. A timesheet row is created
  // lazily, so a missing week means "not started" — without this, a low logged
  // number is indistinguishable from an unsubmitted one.
  const weekRows = !canViewLogged
    ? []
    : await db
        .select({
          staffId: timesheets.staffId,
          weekStartDate: timesheets.weekStartDate,
          status: timesheets.status,
        })
        .from(timesheets)
        .where(inArray(timesheets.weekStartDate, eachWeek(start, end)));

  // **Billable staff only.** Overhead disciplines (leadership, sales, solutions,
  // operations — `NON_BILLABLE_ROLES`) carry `utilizationTarget = 0` by invariant
  // and will never hold a project role, so counting them would inflate the
  // available-hours denominator and drag every utilization figure down for a
  // reason that has nothing to do with how well the delivery team is used. This
  // is a definitional property of the report, not a filter the reader can toggle
  // — the whole thing measures billable capacity.
  const staffList: UtilizationStaff[] = staffRows
    .map((s) => {
      const employment = latestByStaff.get(s.id);
      return {
        id: s.id,
        name: s.name,
        joinDate: s.joinDate,
        terminationDate: s.terminationDate,
        lineOfBusiness: employment?.lineOfBusiness ?? null,
        role: employment?.role ?? null,
        employmentType: employment?.employmentType ?? null,
        // No employment row at all → not counted as billable (default deny).
        isBillable: employment?.isBillable ?? false,
      };
    })
    .filter((s) => s.isBillable);

  const roles: UtilizationRole[] = roleRows
    .filter((r): r is typeof r & { staffId: string } => r.staffId !== null)
    .map((r) => ({
      id: r.id,
      staffId: r.staffId,
      projectId: r.projectId,
      lineOfBusiness: r.lineOfBusiness,
      startDate: r.startDate,
      endDate: r.endDate,
      hoursPerDay: r.hoursPerDay,
    }));

  const firstRoleStartByStaff: Record<string, string> = {};
  for (const row of firstRoleRows) {
    if (row.staffId != null && row.firstStart != null) {
      firstRoleStartByStaff[row.staffId] = row.firstStart;
    }
  }

  return {
    range,
    staff: staffList,
    roles,
    pto: ptoRows,
    entries: entryRows satisfies UtilizationEntry[],
    weeks: weekRows.map((w) => ({
      staffId: w.staffId,
      weekStartDate: w.weekStartDate,
      submitted: w.status === "submitted",
    })),
    firstRoleStartByStaff,
    canViewLogged,
  };
}
