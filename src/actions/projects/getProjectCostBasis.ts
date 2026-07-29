import "server-only";

import {
  getRoleTypeAverageCostsUsd,
  getStaffHourlyCosts,
} from "@/actions/shared/staffHourlyCost";
import { getCurrentUser } from "@/lib/auth/auth";
import { userHasPermission } from "@/lib/auth/permissions";
import type { Currency } from "@/lib/format/currency";
import type { NativeMoney } from "@/lib/projects/project-margin";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";

/** The cost inputs a margin computation needs, in native currencies (+ USD averages). */
export type PlanCostBasis = {
  /** Native hourly cost per staffed assignee, keyed by `staffId`. */
  staffHourlyCost: Record<string, NativeMoney>;
  /** Company-wide average hourly cost per role type, in USD, for open roles. */
  openRoleCostUsd: Partial<Record<ProjectRoleType, number>>;
};

/**
 * The inputs a margin computation needs, or **null** when this viewer may not see a
 * project's cost at all.
 *
 * One signal, not two: `null` IS "may not see margin". A parallel boolean would be a
 * second source of truth for the same fact, and the two could drift into a payload
 * that says "not allowed" while still carrying the numbers.
 *
 * Gated on **`projects.viewMargin`**, not `projects.edit`: a role's cost *is* an
 * individual's compensation (their pay restated hourly), so on a one-role project
 * even the aggregate discloses a salary, and the open-role figure is a
 * per-discipline comp average — the same bulk exposure
 * `getCompensationSummaryData` gates. Revenue is not compensation-derived and stays
 * open.
 *
 * ⚠️ **This is the ONE place that decision is made, and it belongs in the read.**
 * Both plan readers ship to client components — `getProjectPlan` via SSR, and
 * `getOpportunityPlan` via `loadOpportunityPlan`, which is gated only on `crm.edit`
 * and so is reachable by `sales`. Returning `null` here means no compensation-derived
 * value is ever *sent* to a client that merely hides it. Never filter cost in the
 * UI, and never widen `loadOpportunityPlan`'s gate to compensate.
 *
 * Masks rather than throws — the plan is the whole page, and a viewer without the
 * capability should still see the staffing and the revenue (the same choice
 * `getProjectPto` makes for the leave type).
 */
export async function getProjectCostBasis({
  staffIds,
  usdRates,
}: {
  staffIds: readonly string[];
  usdRates: Record<Currency, number>;
}): Promise<PlanCostBasis | null> {
  // A null user falls through to a default-deny role, so this can't leak.
  const user = await getCurrentUser();
  if (
    !userHasPermission(user ?? { role: null }, { projects: ["viewMargin"] })
  ) {
    // Return before touching `staff_employment` at all.
    return null;
  }

  const [costs, openRoleCostUsd] = await Promise.all([
    getStaffHourlyCosts(staffIds),
    getRoleTypeAverageCostsUsd(usdRates),
  ]);

  return {
    staffHourlyCost: Object.fromEntries(costs),
    openRoleCostUsd,
  };
}
