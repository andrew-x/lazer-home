import "server-only";

import { count, desc, eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth/auth";
import { requirePermission } from "@/lib/auth/permissions";
import { db } from "@/lib/db/db";
import { compensationPlan, compensationPlanItem, user } from "@/lib/db/schema";
import {
  COMPENSATION_PLAN_ACCESS,
  type CompensationPlanStatus,
} from "@/lib/performance/compensation-plan";

export type CompensationPlanListRow = {
  id: string;
  name: string;
  status: CompensationPlanStatus;
  effectiveDate: string;
  staffCount: number;
  createdByName: string | null;
  committedAt: Date | null;
};

/**
 * Every compensation plan, newest effective date first, with its headcount.
 *
 * Deliberately carries no compensation figures — the list is a navigation
 * surface, and the amounts only belong on the gated detail page. The gate is
 * still the full one: the existence and naming of comp plans is itself
 * management information.
 */
export async function getCompensationPlans(): Promise<
  CompensationPlanListRow[]
> {
  const currentUser = await getCurrentUser();
  requirePermission(currentUser ?? { role: null }, COMPENSATION_PLAN_ACCESS);

  const rows = await db
    .select({
      id: compensationPlan.id,
      name: compensationPlan.name,
      status: compensationPlan.status,
      effectiveDate: compensationPlan.effectiveDate,
      committedAt: compensationPlan.committedAt,
      createdByName: user.name,
      staffCount: count(compensationPlanItem.id),
    })
    .from(compensationPlan)
    .leftJoin(user, eq(user.id, compensationPlan.createdByUserId))
    .leftJoin(
      compensationPlanItem,
      eq(compensationPlanItem.planId, compensationPlan.id),
    )
    .groupBy(compensationPlan.id, user.name)
    .orderBy(
      desc(compensationPlan.effectiveDate),
      desc(compensationPlan.createdAt),
    );

  return rows;
}
