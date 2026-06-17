import "server-only";

import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/db";
import {
  type StaffEmployment,
  staff,
  staffEmployment,
  user,
} from "@/lib/db/schema";

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
  const latestByStaff = new Map<string, (typeof employmentRows)[number]>();
  for (const row of employmentRows) {
    if (!latestByStaff.has(row.staffId)) latestByStaff.set(row.staffId, row);
  }

  return staffRows.map((s) => {
    const employment = latestByStaff.get(s.id);
    return {
      id: s.id,
      name: s.name,
      email: s.email,
      isActive: s.isActive,
      imageUrl: s.imageUrl ?? null,
      lineOfBusiness: employment?.lineOfBusiness ?? null,
      role: employment?.role ?? null,
      employmentType: employment?.employmentType ?? null,
      isBillable: employment?.isBillable ?? null,
    };
  });
}
