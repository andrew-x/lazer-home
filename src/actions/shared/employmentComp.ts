import "server-only";

import type { Currency } from "@/lib/currency";
import { type StaffEmployment, staffEmployment } from "@/lib/db/schema";

/**
 * The shared latest-employment comp projection behind the compensation and
 * levels summary reads. Both dashboards read the same columns off
 * `staff_employment` (newest-first, then keep the latest per staff in JS), so
 * the Drizzle select shape lives here once — adding/removing a column lands in
 * one place and both reads stay in lockstep. Kept inside `src/actions/**` so
 * `db`/schema access stays in the actions layer (see the database rule).
 */
export const employmentCompColumns = {
  staffId: staffEmployment.staffId,
  lineOfBusiness: staffEmployment.lineOfBusiness,
  role: staffEmployment.role,
  employmentType: staffEmployment.employmentType,
  base: staffEmployment.base,
  guaranteedBonus: staffEmployment.guaranteedBonus,
  hourlyRate: staffEmployment.hourlyRate,
  currency: staffEmployment.currency,
};

/**
 * The comp dimensions the performance dashboards ship per staff member: the
 * filter/group dimensions plus the raw amounts (in the person's own currency).
 * Carries no identity — mirrors the non-`staffId` columns of
 * `employmentCompColumns`.
 */
export type CompensationDimensions = {
  lineOfBusiness: StaffEmployment["lineOfBusiness"];
  role: StaffEmployment["role"];
  employmentType: StaffEmployment["employmentType"];
  base: number;
  guaranteedBonus: number;
  hourlyRate: number;
  currency: Currency;
};
