import "server-only";

import { eq } from "drizzle-orm";
import {
  type CompensationDimensions,
  employmentCompColumns,
} from "@/actions/shared/employmentComp";
import { getCurrentUser } from "@/lib/auth";
import { firstPerKey } from "@/lib/collections";
import { db } from "@/lib/db/db";
import { staff, staffEmployment } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";
import { latestEmploymentFirst } from "@/lib/staff-employment";
import { STAFF_FILTER_OPTIONS } from "@/lib/staff-filters";

/**
 * The filter dimensions offered by the performance dashboard, sourced from the
 * DB enums. Exported here so the page/UI don't import the Drizzle schema (the
 * actions layer owns all `@/lib/db` access).
 */
export const performanceFilterOptions = STAFF_FILTER_OPTIONS;

/**
 * One compensation record per active staff member: the dimensions the dashboard
 * filters/groups by, and the raw amounts (in each person's own currency).
 * **Anonymized — carries no identity (no name/id/email).** Identity never leaves
 * the server: the dashboard filters, normalizes, and aggregates these rows, and
 * the distribution scatter plots them without labels. If a future breakdown needs
 * to filter or group by an identity-linked attribute, do that server-side *before*
 * building the row — the record that ships to the client stays anonymous.
 */
export type CompensationRecord = CompensationDimensions;

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

  // Active staff only — inactive people don't count toward headcount/pay. We read
  // just the id set (never names): a staffId absent from this set is inactive →
  // skipped. Deliberately no identity is assembled server-side.
  const activeStaff = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.isActive, true));
  const activeStaffIds = new Set(activeStaff.map((s) => s.id));

  // Read every employment row newest-first, then keep the latest per staff member
  // in JS (two queries, no N+1) — same pattern as getStaffDirectory. Project only
  // the columns the dashboard needs.
  const employmentRows = await db
    .select(employmentCompColumns)
    .from(staffEmployment)
    .orderBy(...latestEmploymentFirst);

  const latestByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  const records: CompensationRecord[] = [];
  for (const [staffId, row] of latestByStaff) {
    if (!activeStaffIds.has(staffId)) continue; // inactive (or no staff row) → skip
    records.push({
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
