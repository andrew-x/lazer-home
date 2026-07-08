import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { firstPerKey } from "@/lib/collections";
import { db } from "@/lib/db/db";
import {
  billableTypeEnum,
  employmentTypeEnum,
  lineOfBusinessEnum,
  roleEnum,
  type StaffEmployment,
  staff,
  staffEmployment,
  user,
} from "@/lib/db/schema";

/**
 * The values offered by the directory's filter dropdowns, sourced from the DB
 * enums. Exported here so pages don't import the Drizzle schema directly (the
 * actions layer owns all `@/lib/db` access).
 */
export const staffDirectoryFilterOptions = {
  lineOfBusiness: [...lineOfBusinessEnum.enumValues],
  role: [...roleEnum.enumValues],
  employmentType: [...employmentTypeEnum.enumValues],
  billableType: [...billableTypeEnum.enumValues],
};

/**
 * One row per staff member for the directory: identity + active flag + avatar +
 * their latest employment facts. Employment fields are null when a staff row has
 * no employment history (still listed). Includes inactive staff so the directory
 * can offer an "active only" toggle (defaults on in the UI).
 */
export type StaffDirectoryEntry = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  imageUrl: string | null;
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
      isActive: staff.isActive,
      imageUrl: user.image,
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
    .orderBy(
      desc(staffEmployment.effectiveFromDate),
      desc(staffEmployment.createdAt),
    );

  // Rows are newest-first, so the first one seen per staffId is the latest.
  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  return staffRows.map((s) => {
    const employment = latestByStaff.get(s.id);
    return {
      id: s.id,
      name: s.name,
      email: s.email,
      isActive: s.isActive,
      imageUrl: s.imageUrl,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      role: employment?.role ?? null,
      employmentType: employment?.employmentType ?? null,
      isBillable: employment?.isBillable ?? null,
    };
  });
}
