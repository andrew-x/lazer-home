import "server-only";

import { desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";
import { firstPerKey } from "@/lib/collections";
import type { Currency } from "@/lib/currency";
import { db } from "@/lib/db/db";
import {
  employmentTypeEnum,
  lineOfBusinessEnum,
  roleEnum,
  type StaffEmployment,
  staff,
  staffEmployment,
} from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";

/**
 * The filter dimensions offered by the performance dashboard, sourced from the
 * DB enums. Exported here so the page/UI don't import the Drizzle schema (the
 * actions layer owns all `@/lib/db` access). Mirrors `staffDirectoryFilterOptions`.
 */
export const performanceFilterOptions = {
  lineOfBusiness: [...lineOfBusinessEnum.enumValues],
  role: [...roleEnum.enumValues],
  employmentType: [...employmentTypeEnum.enumValues],
};

/**
 * One compensation record per active staff member: the person's name, the
 * dimensions the dashboard filters/groups by, and the raw amounts (in each
 * person's own currency). Carries the name so the dashboard's per-dot tooltip can
 * identify who a point is — NOT a new exposure: the viewer already holds
 * `staff.viewCompensation`, which shows each person's name alongside their comp on
 * the staff profile pages, so the name↔comp mapping is already available to them.
 * Still carries no id/email (nothing here needs them).
 */
export type CompensationRecord = {
  name: string;
  lineOfBusiness: StaffEmployment["lineOfBusiness"];
  role: StaffEmployment["role"];
  employmentType: StaffEmployment["employmentType"];
  base: number;
  guaranteedBonus: number;
  hourlyRate: number;
  currency: Currency;
};

/**
 * Latest-employment compensation rows for every ACTIVE staff member, for the
 * performance dashboard. Gated by `staff.viewCompensation` — an aggregate comp
 * view is bulk comp exposure, so it must never ship to an unauthorized viewer.
 * Returns [] rather than throwing only for the empty-data case; a permission
 * failure throws (via `requirePermission`).
 */
export async function getCompensationSummaryData(): Promise<
  CompensationRecord[]
> {
  // A null user falls through to a default-deny role, so this throws rather than
  // dereferencing null.
  const user = await getCurrentUser();
  requirePermission(user ?? { role: null }, { staff: ["viewCompensation"] });

  // Active staff only — inactive people don't count toward headcount/pay. Their
  // names key the tooltip; a staffId missing from this map is inactive → skipped.
  const activeStaff = await db
    .select({ id: staff.id, name: staff.name })
    .from(staff)
    .where(eq(staff.isActive, true));
  const nameById = new Map(activeStaff.map((s) => [s.id, s.name]));

  // Read every employment row newest-first, then keep the latest per staff member
  // in JS (two queries, no N+1) — same pattern as getStaffDirectory. Project only
  // the columns the dashboard needs.
  const employmentRows = await db
    .select({
      staffId: staffEmployment.staffId,
      lineOfBusiness: staffEmployment.lineOfBusiness,
      role: staffEmployment.role,
      employmentType: staffEmployment.employmentType,
      base: staffEmployment.base,
      guaranteedBonus: staffEmployment.guaranteedBonus,
      hourlyRate: staffEmployment.hourlyRate,
      currency: staffEmployment.currency,
    })
    .from(staffEmployment)
    .orderBy(
      desc(staffEmployment.effectiveFromDate),
      desc(staffEmployment.createdAt),
    );

  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  const records: CompensationRecord[] = [];
  for (const [staffId, row] of latestByStaff) {
    const name = nameById.get(staffId);
    if (name === undefined) continue; // inactive (or no staff row) → skip
    records.push({
      name,
      lineOfBusiness: row.lineOfBusiness,
      role: row.role,
      employmentType: row.employmentType,
      base: row.base,
      guaranteedBonus: row.guaranteedBonus,
      hourlyRate: row.hourlyRate,
      currency: row.currency,
    });
  }
  return records;
}
