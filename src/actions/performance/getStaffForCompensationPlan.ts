import "server-only";

import { asc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { requirePermission } from "@/lib/auth/permissions";
import { firstPerKey } from "@/lib/core/collections";
import { db } from "@/lib/db/db";
import { type StaffEmployment, staff, staffEmployment } from "@/lib/db/schema";
import { COMPENSATION_PLAN_ACCESS } from "@/lib/performance/compensation-plan";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";

/**
 * One selectable staff member for the plan's staff picker: identity plus the four
 * dimensions the picker searches and filters on.
 *
 * Deliberately carries NO compensation. The picker only needs to identify people;
 * the amounts belong to the editor read, which is a narrower audience of rows (the
 * plan's members) than the full active roster. Defaults that do depend on comp —
 * the item's starting currency — are seeded server-side when staff are added, so
 * shipping comp here would be exposure with no purpose.
 */
export type CompensationPlanCandidate = {
  staffId: string;
  name: string;
  lineOfBusiness: StaffEmployment["lineOfBusiness"] | null;
  role: StaffEmployment["role"] | null;
  employmentType: StaffEmployment["employmentType"] | null;
  location: string | null;
};

/**
 * Every ACTIVE staff member, for the plan picker's client-side search + filters.
 *
 * Shipped in one payload rather than behind a debounced server search: the roster
 * is in the hundreds, so `String.includes` filtering is instant and avoids a
 * round-trip, a loading state, and a request race — the same choice the staff
 * directory and the edit-levels grid already make.
 */
export async function getStaffForCompensationPlan(): Promise<
  CompensationPlanCandidate[]
> {
  const currentUser = await getCurrentUser();
  requirePermission(currentUser ?? { role: null }, COMPENSATION_PLAN_ACCESS);

  const [staffRows, employmentRows] = await Promise.all([
    db
      .select({ id: staff.id, name: staff.name, location: staff.location })
      .from(staff)
      .where(eq(staff.isActive, true))
      .orderBy(asc(staff.name)),
    db
      .select({
        staffId: staffEmployment.staffId,
        lineOfBusiness: staffEmployment.lineOfBusiness,
        role: staffEmployment.role,
        employmentType: staffEmployment.employmentType,
      })
      .from(staffEmployment)
      .orderBy(...latestEmploymentFirst),
  ]);

  const employmentByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  return staffRows.map((s) => {
    const employment = employmentByStaff.get(s.id);
    return {
      staffId: s.id,
      name: s.name,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      role: employment?.role ?? null,
      employmentType: employment?.employmentType ?? null,
      location: s.location,
    };
  });
}
