import "server-only";

import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { type StaffEmployment, staffEmployment } from "@/lib/db/schema";

/**
 * A staff member's employment type as of a given date — the newest
 * effective-dated `staff_employment` row that had taken effect by then. Returns
 * `null` when the person has no employment row yet (an incomplete profile) or
 * their first row starts after `date`.
 *
 * `staff_employment` is effective-dated (a change spawns a new row), so "current"
 * always means newest-row-on-or-before the date in question — the same
 * newest-first read the comp dashboards do via `shared/employmentComp.ts`.
 * Shared by the timesheet week page (to decide whether to gate Submit) and
 * `submitTimesheet` (to enforce it), so the rule is derived in exactly one place.
 */
export async function getEmploymentTypeAsOf(
  staffId: string,
  date: string,
): Promise<StaffEmployment["employmentType"] | null> {
  const [row] = await db
    .select({ employmentType: staffEmployment.employmentType })
    .from(staffEmployment)
    .where(
      and(
        eq(staffEmployment.staffId, staffId),
        lte(staffEmployment.effectiveFromDate, date),
      ),
    )
    .orderBy(desc(staffEmployment.effectiveFromDate))
    .limit(1);

  return row?.employmentType ?? null;
}
