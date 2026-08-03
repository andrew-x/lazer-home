import "server-only";

import { asc, eq, inArray } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { requirePermission } from "@/lib/auth/permissions";
import { firstPerKey, groupPerKey } from "@/lib/core/collections";
import { db } from "@/lib/db/db";
import {
  compensationPlan,
  compensationPlanItem,
  type StaffEmployment,
  staff,
  staffEmployment,
  staffRating,
  user,
} from "@/lib/db/schema";
import type { Currency } from "@/lib/format/currency";
import {
  COMPENSATION_PLAN_ACCESS,
  type CompensationPlanItemStatus,
  type CompensationPlanStatus,
  currentCompAmount,
  monthsSince,
} from "@/lib/performance/compensation-plan";
import type { Subratings } from "@/lib/performance/rating-rubric";
import { latestEmploymentFirst } from "@/lib/staff/staff-employment";
import { latestRatingFirst } from "@/lib/staff/staff-rating-history";

/**
 * One compensation figure at a point in time — the shape the editor compares
 * against. `amount` is an annual base or an hourly rate depending on
 * `employmentType`, which is exactly why the type travels with it.
 */
export type CompSnapshot = {
  amount: number | null;
  currency: Currency | null;
  employmentType: StaffEmployment["employmentType"] | null;
  effectiveFrom: string | null;
};

export type CompensationPlanEditorItem = {
  itemId: string;
  staffId: string;
  name: string;
  location: string | null;
  joinDate: string | null;
  /** Computed server-side: a client `new Date()` here would mismatch on hydration. */
  monthsSinceJoin: number | null;
  /** False when the person was deactivated after being added; commit skips them. */
  isActive: boolean;

  lineOfBusiness: StaffEmployment["lineOfBusiness"] | null;
  role: StaffEmployment["role"] | null;
  employmentType: StaffEmployment["employmentType"] | null;
  /** The delivery pool that bills their time — Hub or Global. */
  billableType: StaffEmployment["billableType"] | null;

  /**
   * The baseline the plan is written against: live employment while the plan is
   * a draft, the frozen snapshot once it is committed — so a committed plan's
   * before/after never shifts under it.
   */
  current: CompSnapshot;
  /**
   * Compensation as it stands in Rippling right now, always live. On a committed
   * plan this is what the proposal is reconciled against: if it still differs
   * from `plannedAmount`, the change hasn't been applied upstream.
   */
  live: CompSnapshot;
  /** The employment row before the current one — their last actual comp change. */
  previous: CompSnapshot;

  /** The person's latest saved rating, for context beside the proposed one. */
  lastLevel: number | null;
  lastRatedOn: string | null;

  level: number | null;
  subratings: Subratings;
  plannedAmount: number | null;
  /** A one-off lump sum, denominated in `plannedCurrency` like `plannedAmount`. */
  plannedBonus: number | null;
  plannedCurrency: Currency | null;
  status: CompensationPlanItemStatus;
  evaluationNotes: string | null;
  compensationNotes: string | null;
};

export type CompensationPlanDetail = {
  id: string;
  name: string;
  status: CompensationPlanStatus;
  effectiveDate: string;
  committedAt: Date | null;
  createdByName: string | null;
  committedByName: string | null;
  items: CompensationPlanEditorItem[];
};

const EMPTY_SNAPSHOT: CompSnapshot = {
  amount: null,
  currency: null,
  employmentType: null,
  effectiveFrom: null,
};

/**
 * The full editor payload for one plan, or null when the id is unknown.
 *
 * Four queries, no N+1: the plan header, its items joined to `staff`, every
 * employment row for those staff (newest first), and every rating row for those
 * staff (newest first). The last two are folded in JS — `firstPerKey` for the
 * current fact and `groupPerKey` where the row *before* it is needed too, which
 * is how each person's previous compensation change is derived. Bounded by the
 * plan's membership, so "every row" is tens, not thousands.
 *
 * Rows here are identity-bearing, unlike the aggregate `/analytics` reads. That
 * is inherent to the feature and the reason for the stricter combined gate.
 */
export async function getCompensationPlan(
  planId: string,
): Promise<CompensationPlanDetail | null> {
  const currentUser = await getCurrentUser();
  requirePermission(currentUser ?? { role: null }, COMPENSATION_PLAN_ACCESS);

  const [plan] = await db
    .select({
      id: compensationPlan.id,
      name: compensationPlan.name,
      status: compensationPlan.status,
      effectiveDate: compensationPlan.effectiveDate,
      committedAt: compensationPlan.committedAt,
      createdByUserId: compensationPlan.createdByUserId,
      committedByUserId: compensationPlan.committedByUserId,
    })
    .from(compensationPlan)
    .where(eq(compensationPlan.id, planId))
    .limit(1);

  if (!plan) return null;

  const itemRows = await db
    .select({
      itemId: compensationPlanItem.id,
      staffId: compensationPlanItem.staffId,
      level: compensationPlanItem.level,
      subratings: compensationPlanItem.subratings,
      plannedAmount: compensationPlanItem.plannedAmount,
      plannedBonus: compensationPlanItem.plannedBonus,
      plannedCurrency: compensationPlanItem.plannedCurrency,
      status: compensationPlanItem.status,
      evaluationNotes: compensationPlanItem.evaluationNotes,
      compensationNotes: compensationPlanItem.compensationNotes,
      snapshotAmount: compensationPlanItem.snapshotAmount,
      snapshotCurrency: compensationPlanItem.snapshotCurrency,
      snapshotEmploymentType: compensationPlanItem.snapshotEmploymentType,
      name: staff.name,
      location: staff.location,
      joinDate: staff.joinDate,
      isActive: staff.isActive,
    })
    .from(compensationPlanItem)
    .innerJoin(staff, eq(staff.id, compensationPlanItem.staffId))
    .where(eq(compensationPlanItem.planId, planId))
    .orderBy(asc(staff.name));

  const staffIds = itemRows.map((row) => row.staffId);

  // Resolve the two audit names in one pass over `user` rather than two joins.
  const auditUserIds = [plan.createdByUserId, plan.committedByUserId].filter(
    (value): value is string => value != null,
  );

  const [employmentRows, ratingRows, auditUsers] = await Promise.all([
    staffIds.length
      ? db
          .select({
            staffId: staffEmployment.staffId,
            lineOfBusiness: staffEmployment.lineOfBusiness,
            role: staffEmployment.role,
            employmentType: staffEmployment.employmentType,
            billableType: staffEmployment.billableType,
            base: staffEmployment.base,
            hourlyRate: staffEmployment.hourlyRate,
            currency: staffEmployment.currency,
            effectiveFromDate: staffEmployment.effectiveFromDate,
          })
          .from(staffEmployment)
          .where(inArray(staffEmployment.staffId, staffIds))
          .orderBy(...latestEmploymentFirst)
      : Promise.resolve([]),
    staffIds.length
      ? db
          .select({
            staffId: staffRating.staffId,
            level: staffRating.level,
            effectiveDate: staffRating.effectiveDate,
          })
          .from(staffRating)
          .where(inArray(staffRating.staffId, staffIds))
          .orderBy(...latestRatingFirst)
      : Promise.resolve([]),
    auditUserIds.length
      ? db
          .select({ id: user.id, name: user.name })
          .from(user)
          .where(inArray(user.id, auditUserIds))
      : Promise.resolve([]),
  ]);

  const employmentByStaff = groupPerKey(employmentRows, (row) => row.staffId);
  const latestRatingByStaff = firstPerKey(ratingRows, (row) => row.staffId);
  const nameByUserId = new Map(auditUsers.map((u) => [u.id, u.name]));

  // Wall-clock "today" for tenure. One value for the whole payload so two rows
  // can never straddle midnight and disagree.
  const now = new Date();

  const toSnapshot = (
    row: (typeof employmentRows)[number] | undefined,
  ): CompSnapshot =>
    row
      ? {
          amount: currentCompAmount(row),
          currency: row.currency,
          employmentType: row.employmentType,
          effectiveFrom: row.effectiveFromDate,
        }
      : EMPTY_SNAPSHOT;

  const items: CompensationPlanEditorItem[] = itemRows.map((row) => {
    const history = employmentByStaff.get(row.staffId) ?? [];
    const live = toSnapshot(history[0]);
    const previous = toSnapshot(history[1]);
    const rating = latestRatingByStaff.get(row.staffId);

    // A committed plan is a historical record: it compares against what comp
    // actually was at commit time, not what it has since become.
    const current: CompSnapshot =
      plan.status === "COMMITTED"
        ? {
            amount: row.snapshotAmount,
            currency: row.snapshotCurrency,
            employmentType: row.snapshotEmploymentType,
            effectiveFrom: null,
          }
        : live;

    return {
      itemId: row.itemId,
      staffId: row.staffId,
      name: row.name,
      location: row.location,
      joinDate: row.joinDate,
      monthsSinceJoin: monthsSince(row.joinDate, now),
      isActive: row.isActive,
      lineOfBusiness: history[0]?.lineOfBusiness ?? null,
      role: history[0]?.role ?? null,
      employmentType: history[0]?.employmentType ?? null,
      billableType: history[0]?.billableType ?? null,
      current,
      live,
      previous,
      lastLevel: rating?.level ?? null,
      lastRatedOn: rating?.effectiveDate ?? null,
      level: row.level,
      subratings: row.subratings ?? {},
      plannedAmount: row.plannedAmount,
      plannedBonus: row.plannedBonus,
      plannedCurrency: row.plannedCurrency,
      status: row.status,
      evaluationNotes: row.evaluationNotes,
      compensationNotes: row.compensationNotes,
    };
  });

  return {
    id: plan.id,
    name: plan.name,
    status: plan.status,
    effectiveDate: plan.effectiveDate,
    committedAt: plan.committedAt,
    createdByName: plan.createdByUserId
      ? (nameByUserId.get(plan.createdByUserId) ?? null)
      : null,
    committedByName: plan.committedByUserId
      ? (nameByUserId.get(plan.committedByUserId) ?? null)
      : null,
    items,
  };
}
