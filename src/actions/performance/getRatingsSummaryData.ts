import "server-only";

import { eq } from "drizzle-orm";
import {
  type CompensationDimensions,
  employmentCompColumns,
} from "@/actions/shared/employmentComp";
import { getCurrentUser } from "@/lib/auth";
import { firstPerKey } from "@/lib/collections";
import { db } from "@/lib/db/db";
import { staff, staffEmployment, staffRating } from "@/lib/db/schema";
import { requirePermission } from "@/lib/permissions";
import { latestEmploymentFirst } from "@/lib/staff-employment";
import { STAFF_FILTER_OPTIONS } from "@/lib/staff-filters";
import { latestRatingFirst } from "@/lib/staff-rating-history";

/**
 * The filter dimensions offered by the Levels dashboard, sourced from the DB
 * enums. Exported here so the page/UI don't import the Drizzle schema (the
 * actions layer owns all `@/lib/db` access). `role` also drives the ordered
 * by-level and by-role breakdowns.
 */
export const ratingsFilterOptions = STAFF_FILTER_OPTIONS;

/**
 * One row per active staff member for the Levels dashboard: the person's current
 * overall level (null = unrated) and their current employment (dimensions + raw
 * comp in their own currency), so the client can group by level, compute the
 * per-level comp/rate breakdown, and the average level overall and per role.
 *
 * `employment` is null for the (rare) active staffer with no employment row: they
 * still count toward headcount / the level distribution / unrated, matching the
 * edit page (which lists every active staffer), but contribute no comp/role.
 *
 * **Anonymized — carries no identity (no name/id/email).** Identity never leaves
 * the server; the dashboard only filters, normalizes, and aggregates these rows.
 */
export type RatingRecord = {
  level: number | null;
  employment: CompensationDimensions | null;
};

/**
 * Current level + latest-employment comp for every ACTIVE staff member, for the
 * Levels dashboard. Gated by `ratings.view` (manager/admin) — ratings are
 * sensitive and this also exposes bulk comp, so it must never ship to an
 * unauthorized viewer. A permission failure throws (via `requirePermission`);
 * empty data returns [].
 */
export async function getRatingsSummaryData(): Promise<RatingRecord[]> {
  // A null user falls through to a default-deny role, so this throws rather than
  // dereferencing null.
  const user = await getCurrentUser();
  requirePermission(user ?? { role: null }, { ratings: ["view"] });

  // Active staff drive the breakdown — inactive people don't count. Read just the
  // id set (never names); every active staffer yields a record whether or not
  // they have a rating or an employment row.
  const activeStaff = await db
    .select({ id: staff.id })
    .from(staff)
    .where(eq(staff.isActive, true));

  // Latest employment row per staff, and latest rating row per staff: read each
  // newest-first, keep the first per staff in JS (two queries each, no N+1).
  const [employmentRows, ratingRows] = await Promise.all([
    db
      .select(employmentCompColumns)
      .from(staffEmployment)
      .orderBy(...latestEmploymentFirst),
    db
      .select({
        staffId: staffRating.staffId,
        level: staffRating.level,
      })
      .from(staffRating)
      .orderBy(...latestRatingFirst),
  ]);

  const latestEmploymentByStaff = firstPerKey(
    employmentRows,
    (row) => row.staffId,
  );
  const latestRatingByStaff = firstPerKey(ratingRows, (row) => row.staffId);

  return activeStaff.map(({ id: staffId }) => {
    const employment = latestEmploymentByStaff.get(staffId);
    return {
      // No rating row, or a row whose level is null, both mean unrated.
      level: latestRatingByStaff.get(staffId)?.level ?? null,
      employment: employment
        ? {
            lineOfBusiness: employment.lineOfBusiness,
            role: employment.role,
            employmentType: employment.employmentType,
            base: employment.base,
            guaranteedBonus: employment.guaranteedBonus,
            hourlyRate: employment.hourlyRate,
            currency: employment.currency,
          }
        : null,
    };
  });
}
