import "server-only";

import { asc, eq } from "drizzle-orm";
import { firstPerKey } from "@/lib/core/collections";
import { db } from "@/lib/db/db";
import {
  type StaffEmployment,
  staff,
  staffEmployment,
  user,
} from "@/lib/db/schema";
import type { StaffSkill } from "@/lib/staff/skills";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { STAFF_FILTER_OPTIONS } from "@/lib/staff/staff-filters";

/**
 * The values offered by the directory's filter dropdowns. An alias of the shared
 * `STAFF_FILTER_OPTIONS`, kept so the directory and bulk-edit pages don't have to
 * churn their import sites.
 *
 * `billableType` used to be declared here, which put it out of reach of any client
 * component (this module is `server-only`). It now lives with the other dimensions
 * in the pure module, where the compensation-plan toolbar can read it too.
 */
export const staffDirectoryFilterOptions = STAFF_FILTER_OPTIONS;

/**
 * One row per staff member for the directory: identity + active flag + avatar +
 * their latest employment facts. Employment fields are null when a staff row has
 * no employment history (still listed). Includes inactive staff so the directory
 * can offer an "active only" toggle (defaults on in the UI).
 *
 * Feeds both `/staff` views — the card grid and the org chart (`?view=org`) —
 * which is why `managerId` rides along even though the grid ignores it. One read
 * and one entry type keep "line of business = Fintech" meaning the same people in
 * both views; a second near-copy of the two-query + `latestEmploymentFirst` shape
 * is where the effective-dating rule would drift.
 */
export type StaffDirectoryEntry = {
  id: string;
  name: string;
  email: string;
  location: string | null;
  isActive: boolean;
  imageUrl: string | null;
  skills: StaffSkill[];
  /**
   * Who this person reports to (`staff.managerId`), or null at the top of the org.
   * Import-only and unguarded against cycles or self-reference at the DB level
   * (ADR 0026) — the org chart's `buildOrgForest` does its own self/cycle/orphan
   * guarding rather than trusting this to be a well-formed tree.
   */
  managerId: string | null;
  lineOfBusiness: StaffEmployment["lineOfBusiness"] | null;
  role: StaffEmployment["role"] | null;
  employmentType: StaffEmployment["employmentType"] | null;
  isBillable: boolean | null;
};

export async function getStaffDirectory(): Promise<StaffDirectoryEntry[]> {
  const staffRows = await db
    .select({
      id: staff.id,
      name: staff.name,
      email: staff.email,
      location: staff.location,
      isActive: staff.isActive,
      imageUrl: user.image,
      skills: staff.skills,
      managerId: staff.managerId,
    })
    .from(staff)
    .leftJoin(user, eq(staff.userId, user.id))
    .orderBy(asc(staff.name));

  // Reads every employment row, then keeps the latest per staff member in JS —
  // two queries, no N+1. Fine at company scale; if the effective-dating history
  // grows large, switch to a `DISTINCT ON (staff_id)` / lateral join instead.
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

  // Rows are newest-first, so the first one seen per staffId is the latest.
  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  return staffRows.map((s) => {
    const employment = latestByStaff.get(s.id);
    return {
      id: s.id,
      name: s.name,
      email: s.email,
      location: s.location,
      isActive: s.isActive,
      imageUrl: s.imageUrl,
      skills: s.skills,
      managerId: s.managerId,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      role: employment?.role ?? null,
      employmentType: employment?.employmentType ?? null,
      isBillable: employment?.isBillable ?? null,
    };
  });
}
