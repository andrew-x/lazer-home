import "server-only";

import { asc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { firstPerKey } from "@/lib/collections";
import { db } from "@/lib/db/db";
import {
  type StaffEmployment,
  staff,
  staffEmployment,
  staffRating,
} from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";
import { latestEmploymentFirst } from "@/lib/staff-employment";
import { encodeLevelValue } from "@/lib/staff-rating";
import { latestRatingFirst } from "@/lib/staff-rating-history";

/**
 * One editable row per ACTIVE staff member for the edit-levels table: identity,
 * their current role + line of business (for context and filtering), and their
 * current level encoded for the Select (`"none"` = unrated, else `"0".."4"` — so
 * the editor's draft is a plain string, like the other bulk-edit dropdowns).
 * Mirrors `getStaffEmploymentForEdit`'s two-query, latest-per-staff approach.
 * Active only — you rate current staff, not departed ones.
 */
export type StaffRatingEditRow = {
  staffId: string;
  name: string;
  role: StaffEmployment["role"] | null;
  lineOfBusiness: StaffEmployment["lineOfBusiness"] | null;
  level: string;
};

export async function getStaffRatingsForEdit(): Promise<StaffRatingEditRow[]> {
  // Sensitive: gate exactly like the dashboard read — manager/admin only.
  const user = await getCurrentUser();
  requirePermission(user ?? { role: null }, { ratings: ["view"] });

  const staffRows = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.isActive, true))
    .orderBy(asc(staff.name));

  // Latest employment per staff (role + line of business, for context/filtering)
  // and latest rating per staff (current level).
  const [employmentRows, ratingRows] = await Promise.all([
    db
      .select({
        staffId: staffEmployment.staffId,
        role: staffEmployment.role,
        lineOfBusiness: staffEmployment.lineOfBusiness,
      })
      .from(staffEmployment)
      .orderBy(...latestEmploymentFirst),
    db
      .select({ staffId: staffRating.staffId, level: staffRating.level })
      .from(staffRating)
      .orderBy(...latestRatingFirst),
  ]);

  const employmentByStaff = firstPerKey(employmentRows, (row) => row.staffId);
  const latestRatingByStaff = firstPerKey(ratingRows, (row) => row.staffId);

  return staffRows.map((s) => {
    const employment = employmentByStaff.get(s.id);
    return {
      staffId: s.id,
      name: s.name,
      role: employment?.role ?? null,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      level: encodeLevelValue(latestRatingByStaff.get(s.id)?.level ?? null),
    };
  });
}
