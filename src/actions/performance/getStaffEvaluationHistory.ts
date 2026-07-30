import "server-only";

import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { staffRating, user as userTable } from "@/lib/db/schema";
import type { Subratings } from "@/lib/performance/rating-rubric";
import { latestRatingFirst } from "@/lib/staff/staff-rating-history";

/** One dated evaluation: the overall level plus whatever subratings it carried. */
export type EvaluationHistoryEntry = {
  id: string;
  /** As-of date of the evaluation, "YYYY-MM-DD" (wall-clock, no zone). */
  effectiveDate: string;
  /** L0–L4, or null for an explicitly-unrated evaluation. */
  level: number | null;
  subratings: Subratings | null;
  /** Who saved it; null once their account is gone (`evaluatedByUserId` is set null). */
  evaluatedByName: string | null;
};

/**
 * One person's rating history, newest first — every dated `staff_rating` row, not
 * just the current one.
 *
 * **Gated on `ratings.view` (manager/admin) with no owner path**, the strictest
 * read in the app: a staffer never sees their own level, nor anyone else's
 * ([ADR 0032](../../../docs/decisions/0032-staff-rating-levels-effective-dated-manager-only.md)).
 * Unlike compensation (own always visible) and feedback (a limited recipient
 * tier), there is deliberately no self-view tier to fall back to — so this returns
 * **`null`** for anyone without the capability and the surface disappears entirely.
 *
 * Known consequence, inherited rather than introduced: a capability *holder* can
 * see their **own** history through this, exactly as they already can in the
 * `/people/levels` grid (`getStaffRatingsForEdit` lists every active
 * staff member including the caller). Excluding self here would diverge from that
 * grid for no real gain — the level is one click away either way.
 */
export async function getStaffEvaluationHistory(
  staffId: string,
): Promise<EvaluationHistoryEntry[] | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  if (!userHasPermission(user, { ratings: ["view"] })) return null;

  return db
    .select({
      id: staffRating.id,
      effectiveDate: staffRating.effectiveDate,
      level: staffRating.level,
      subratings: staffRating.subratings,
      evaluatedByName: userTable.name,
    })
    .from(staffRating)
    .leftJoin(userTable, eq(staffRating.evaluatedByUserId, userTable.id))
    .where(eq(staffRating.staffId, staffId))
    .orderBy(...latestRatingFirst);
}
