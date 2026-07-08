import "server-only";

import { asc, desc } from "drizzle-orm";
import { firstPerKey } from "@/lib/collections";
import { db } from "@/lib/db/db";
import { type StaffEmployment, staff, staffEmployment } from "@/lib/db/schema";

/**
 * One editable row per staff member for the admin bulk-edit-roles table:
 * identity + active flag + their latest employment row's id, effective date, and
 * every editable employment fact. Mirrors `getStaffDirectory`'s two-query,
 * latest-per-staff approach (no N+1). Includes inactive staff so the table can
 * offer an "active only" filter. Staff with no employment row are omitted —
 * there's nothing to edit.
 */
export type StaffEmploymentEditRow = {
  staffId: string;
  name: string;
  isActive: boolean;
  employmentId: string;
  effectiveFromDate: string;
  lineOfBusiness: StaffEmployment["lineOfBusiness"];
  role: StaffEmployment["role"];
  employmentType: StaffEmployment["employmentType"];
  isBillable: boolean;
  utilizationTarget: number;
  billableType: StaffEmployment["billableType"];
  isManagement: boolean;
};

export async function getStaffEmploymentForEdit(): Promise<
  StaffEmploymentEditRow[]
> {
  // Reachable only from the localhost-gated admin bulk-edit page (ADR 0008,
  // orthogonal to RBAC). Note: a self-contained `assertLocalhost()` here would
  // throw during `next build` static prerender (NODE_ENV=production), so the
  // boundary stays the admin layout's host gate + production hard-deny.
  const staffRows = await db
    .select({
      id: staff.id,
      name: staff.name,
      isActive: staff.isActive,
    })
    .from(staff)
    .orderBy(asc(staff.name));

  // Read every employment row newest-first, then keep the latest per staff in JS
  // (effectiveFromDate desc, createdAt desc tiebreak — ADR 0007).
  const employmentRows = await db
    .select({
      id: staffEmployment.id,
      staffId: staffEmployment.staffId,
      effectiveFromDate: staffEmployment.effectiveFromDate,
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
      isBillable: staffEmployment.isBillable,
      utilizationTarget: staffEmployment.utilizationTarget,
      billableType: staffEmployment.billableType,
      isManagement: staffEmployment.isManagement,
    })
    .from(staffEmployment)
    .orderBy(
      desc(staffEmployment.effectiveFromDate),
      desc(staffEmployment.createdAt),
    );

  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  const rows: StaffEmploymentEditRow[] = [];
  for (const s of staffRows) {
    const employment = latestByStaff.get(s.id);
    if (!employment) continue;
    rows.push({
      staffId: s.id,
      name: s.name,
      isActive: s.isActive,
      employmentId: employment.id,
      effectiveFromDate: employment.effectiveFromDate,
      lineOfBusiness: employment.lineOfBusiness,
      role: employment.role,
      employmentType: employment.employmentType,
      isBillable: employment.isBillable,
      utilizationTarget: employment.utilizationTarget,
      billableType: employment.billableType,
      isManagement: employment.isManagement,
    });
  }
  return rows;
}
