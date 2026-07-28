import "server-only";

import { eq, type InferInsertModel, inArray } from "drizzle-orm";
import { firstPerKey } from "@/lib/core/collections";
import { UserSafeActionError } from "@/lib/core/errors";
import { db } from "@/lib/db/db";
import { generateId } from "@/lib/db/ids";
import {
  compensationPlan,
  type compensationPlanItem,
  staff,
  staffEmployment,
  staffRating,
} from "@/lib/db/schema";
import {
  type CompensationPlanStatus,
  PLAN_LOCKED_MESSAGE,
} from "@/lib/performance/compensation-plan";
import { sanitizeSubratings } from "@/lib/performance/rating-rubric";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { latestRatingFirst } from "@/lib/staff/staff-rating-history";

export type CompensationPlanItemInsert = InferInsertModel<
  typeof compensationPlanItem
>;

/** The paths every plan mutation invalidates. */
export function planPaths(planId: string): string[] {
  return [
    "/performance/compensation-plans",
    `/performance/compensation-plans/${planId}`,
  ];
}

type PlanRow = {
  id: string;
  status: CompensationPlanStatus;
  effectiveDate: string;
};

/**
 * Load a plan and assert it is still editable.
 *
 * Every mutation re-reads status here rather than trusting the client's view: a
 * co-manager can commit the plan while someone else has the editor open, and a
 * committed plan is a historical record. The error is user-safe and specific so
 * the client can recognise it and drop into read-only mode instead of retrying.
 */
export async function requireDraftPlan(planId: string): Promise<PlanRow> {
  const [plan] = await db
    .select({
      id: compensationPlan.id,
      status: compensationPlan.status,
      effectiveDate: compensationPlan.effectiveDate,
    })
    .from(compensationPlan)
    .where(eq(compensationPlan.id, planId))
    .limit(1);

  if (!plan) {
    throw new UserSafeActionError("That compensation plan no longer exists.");
  }
  if (plan.status !== "DRAFT") {
    throw new UserSafeActionError(PLAN_LOCKED_MESSAGE);
  }
  return plan;
}

/**
 * Build the plan-item rows for a set of staff, seeded from what we already know
 * about each person.
 *
 * Seeded: the proposed rating starts at the person's current level and
 * subratings (the editor's "default to their last rating"), and the planned
 * currency starts as their compensation currency so the common same-currency
 * case needs no interaction.
 *
 * Deliberately NOT seeded: `plannedAmount` stays null. Pre-filling it with the
 * current figure would make "no proposal entered yet" indistinguishable from
 * "reviewed, and deliberately no change" — a distinction the whole plan exists
 * to track.
 *
 * Unknown and inactive ids are dropped silently, so a stale picker payload
 * cannot add a departed employee or fail the whole request.
 */
export async function buildPlanItems(
  planId: string,
  staffIds: readonly string[],
): Promise<CompensationPlanItemInsert[]> {
  const unique = [...new Set(staffIds)];
  if (unique.length === 0) return [];

  const [staffRows, ratingRows, employmentRows] = await Promise.all([
    db
      .select({ id: staff.id, isActive: staff.isActive })
      .from(staff)
      .where(inArray(staff.id, unique)),
    db
      .select({
        staffId: staffRating.staffId,
        level: staffRating.level,
        subratings: staffRating.subratings,
      })
      .from(staffRating)
      .where(inArray(staffRating.staffId, unique))
      .orderBy(...latestRatingFirst),
    db
      .select({
        staffId: staffEmployment.staffId,
        role: staffEmployment.role,
        currency: staffEmployment.currency,
      })
      .from(staffEmployment)
      .where(inArray(staffEmployment.staffId, unique))
      .orderBy(...latestEmploymentFirst),
  ]);

  const activeIds = new Set(
    staffRows.filter((row) => row.isActive).map((row) => row.id),
  );
  const ratingByStaff = firstPerKey(ratingRows, (row) => row.staffId);
  const employmentByStaff = firstPerKey(employmentRows, (row) => row.staffId);

  return unique
    .filter((staffId) => activeIds.has(staffId))
    .map((staffId) => {
      const rating = ratingByStaff.get(staffId);
      const employment = employmentByStaff.get(staffId);
      return {
        id: generateId("cplanitem"),
        planId,
        staffId,
        level: rating?.level ?? null,
        // Re-sanitize on the way in: a stored rating may predate a role change,
        // in which case some of its categories no longer apply to this person.
        subratings: sanitizeSubratings(
          rating?.subratings ?? null,
          employment?.role ?? null,
        ),
        plannedAmount: null,
        plannedCurrency: employment?.currency ?? null,
      } satisfies CompensationPlanItemInsert;
    });
}
