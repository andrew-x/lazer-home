import "server-only";

import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { cache } from "react";
import { getCurrentUser } from "@/lib/auth/auth";
import { firstPerKey, groupPerKey } from "@/lib/core/collections";
import { db } from "@/lib/db/db";
import {
  projectRoles,
  staff,
  staffEmployment,
  staffPto,
  timeEntries,
  timesheets,
} from "@/lib/db/schema";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import type { TimesheetCategory } from "@/lib/timesheets/timesheet-category";
import {
  buildPlanRow,
  type UtilizationRecord,
} from "@/lib/timesheets/utilization";

/** Typed so dropping the category from the enum fails the build, not the query. */
const PTO: TimesheetCategory = "PTO";

export type OrgUtilizationData = {
  /** The elapsed year measured: 1 January through today. */
  rangeStart: string;
  rangeEnd: string;
  /** One record per active, billable person — identity-free by design. */
  records: UtilizationRecord[];
  /** Active staff left out because their employment isn't billable. */
  nonBillableExcluded: number;
  /** Active staff with no employment row, so no billability to judge. */
  withoutEmployment: number;
};

/**
 * Organization-wide year-to-date utilization inputs. The arithmetic and the cohort
 * split live in `@/lib/timesheets/utilization`; this read joins the five sources
 * and hands over anonymous rows.
 *
 * **Nothing looks forward** — timesheets are bounded to weeks that have started
 * and the plan range stops at `rangeEnd` (today), so future bookings don't inflate
 * the planned figure.
 *
 * **Identity-free on purpose.** The home dashboard's organization section is
 * visible to every signed-in user, and per-person hours are performance-adjacent.
 * Records therefore carry no `staffId` and no name — the same posture
 * `getBonusSummaryData` takes, and the reason the roles-to-hours join happens here
 * rather than in the pure layer: doing it client-side would require shipping a
 * joinable id. `MIN_COHORT_SIZE` in the pure layer then withholds rates for a
 * cohort too small to aggregate without naming someone. Do not widen this to
 * return per-person rows.
 *
 * No capability gate — the figures are aggregates that disclose no individual's
 * hours, and the section is open to everyone, consistent with `/allocations` being
 * deliberately ungated. It does still **fail closed without a session**, matching
 * every other cross-person read (`getProjectPto`, `getBonusSummaryData`): the
 * `(app)` layout is the real gate, but a read this wide shouldn't depend on its
 * caller for that.
 *
 * **Population** is active staff whose *latest* employment row is billable.
 * Non-billable staff (ops, leadership) have a `utilizationTarget` of 0 by
 * invariant, so averaging them in would move the number every time one is hired;
 * they're counted in `nonBillableExcluded` so the card can say so. Staff with no
 * employment row are counted separately and never defaulted into `FULL_TIME`.
 */
export const getOrgUtilization = cache(
  async (rangeStart: string, rangeEnd: string): Promise<OrgUtilizationData> => {
    const empty: OrgUtilizationData = {
      rangeStart,
      rangeEnd,
      records: [],
      nonBillableExcluded: 0,
      withoutEmployment: 0,
    };
    if (!(await getCurrentUser())) return empty;

    const [staffRows, employmentRows, hourRows, roleRows, ptoRows] =
      await Promise.all([
        db.select({ id: staff.id }).from(staff).where(eq(staff.isActive, true)),

        // Latest employment fact per person (effective-dating tiebreak, ADR 0007).
        db
          .select({
            staffId: staffEmployment.staffId,
            employmentType: staffEmployment.employmentType,
            isBillable: staffEmployment.isBillable,
            utilizationTarget: staffEmployment.utilizationTarget,
          })
          .from(staffEmployment)
          .orderBy(...latestEmploymentFirst),

        // Billability is structural — an entry targets a project or a category,
        // never both. Same CASE sums as `getTimesheetList`, over the elapsed year.
        db
          .select({
            staffId: timesheets.staffId,
            projectHours:
              sql<number>`coalesce(sum(case when ${timeEntries.projectId} is not null then ${timeEntries.hours} else 0 end), 0)`.mapWith(
                Number,
              ),
            ptoHours:
              sql<number>`coalesce(sum(case when ${timeEntries.category}::text = ${PTO} then ${timeEntries.hours} else 0 end), 0)`.mapWith(
                Number,
              ),
            totalHours:
              sql<number>`coalesce(sum(${timeEntries.hours}), 0)`.mapWith(
                Number,
              ),
          })
          .from(timesheets)
          .leftJoin(timeEntries, eq(timeEntries.timesheetId, timesheets.id))
          .where(
            and(
              gte(timesheets.weekStartDate, rangeStart),
              lte(timesheets.weekStartDate, rangeEnd),
            ),
          )
          .groupBy(timesheets.staffId),

        db
          .select({
            staffId: projectRoles.staffId,
            status: projectRoles.status,
            startDate: projectRoles.startDate,
            endDate: projectRoles.endDate,
            hoursPerDay: projectRoles.hoursPerDay,
          })
          .from(projectRoles)
          .where(
            and(
              inArray(projectRoles.status, ["tentative", "confirmed"]),
              lte(projectRoles.startDate, rangeEnd),
              gte(projectRoles.endDate, rangeStart),
            ),
          ),

        db
          .select({
            staffId: staffPto.staffId,
            startDate: staffPto.startDate,
            endDate: staffPto.endDate,
          })
          .from(staffPto)
          .where(
            and(
              eq(staffPto.isPending, false),
              lte(staffPto.startDate, rangeEnd),
              gte(staffPto.endDate, rangeStart),
            ),
          ),
      ]);

    const employmentByStaff = firstPerKey(employmentRows, (row) => row.staffId);
    const hoursByStaff = new Map(hourRows.map((row) => [row.staffId, row]));
    const rolesByStaff = groupPerKey(
      roleRows.filter((row): row is typeof row & { staffId: string } =>
        Boolean(row.staffId),
      ),
      (row) => row.staffId,
    );
    const ptoByStaff = groupPerKey(ptoRows, (row) => row.staffId);

    const records: UtilizationRecord[] = [];
    let nonBillableExcluded = 0;
    let withoutEmployment = 0;

    for (const person of staffRows) {
      const employment = employmentByStaff.get(person.id);
      if (!employment) {
        withoutEmployment += 1;
        continue;
      }
      if (!employment.isBillable) {
        nonBillableExcluded += 1;
        continue;
      }

      const logged = hoursByStaff.get(person.id);
      records.push({
        employmentType: employment.employmentType,
        utilizationTarget: employment.utilizationTarget,
        hours: logged
          ? {
              projectHours: logged.projectHours,
              ptoHours: logged.ptoHours,
              totalHours: logged.totalHours,
            }
          : null,
        plan: buildPlanRow(
          rolesByStaff.get(person.id) ?? [],
          ptoByStaff.get(person.id) ?? [],
          rangeStart,
          rangeEnd,
        ),
      });
    }

    return {
      rangeStart,
      rangeEnd,
      records,
      nonBillableExcluded,
      withoutEmployment,
    };
  },
);
