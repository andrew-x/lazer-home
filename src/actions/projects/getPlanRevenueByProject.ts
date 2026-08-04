import "server-only";

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db/db";
import { projectRoles } from "@/lib/db/schema";
import type { Currency, DisplayCurrency } from "@/lib/format/currency";
import type { BillingType } from "@/lib/projects/project-billing";
import {
  computeProjectMargin,
  type MarginBilling,
  type MarginRoleInput,
} from "@/lib/projects/project-margin";

/** What one project's plan is worth, and whether it can be priced at all. */
export type PlanRevenue = {
  billingType: BillingType | null;
  /**
   * Plan revenue in the requested display currency, or **null when the plan can't
   * be priced**: no billing model, or **time and materials with no counted roles**
   * (an unbuilt plan, or one whose every role is cancelled).
   *
   * That second case is why this isn't simply `totals.revenue`: T&M revenue is a sum
   * over counted roles, and an empty sum is a confident `0` — so a signed T&M project
   * whose plan hasn't been built yet would report "no work sold", a lie rather than a
   * zero.
   *
   * **It applies to T&M only, deliberately.** A fixed fee is a contracted total that
   * doesn't depend on staffing, so an unstaffed fixed-fee project still has a
   * perfectly well-defined revenue and reports it — which is the common state of a
   * deal at Negotiating, where the fee is agreed before the plan is built. This is
   * where the rule parts company with `getProjectsList`'s `listMargin`, whose
   * blanket `countedRoleCount === 0 → null` is about **margin**: an unstaffed plan
   * has a true-zero *cost*, so a fixed fee there would read as a triumphant 100%
   * margin. Revenue has no such problem. Don't "align" the two.
   */
  revenue: number | null;
  /** Currencies an FX rate was applied to — the `FxRateNote`'s input. */
  convertedFrom: Currency[];
};

/**
 * Plan revenue for many projects at once — the aggregate read behind the home
 * dashboard's funnel value.
 *
 * **One query.** Billing comes from the caller (both pipeline reads already join
 * `projects` for it), so this only fetches `project_roles` and folds
 * `computeProjectMargin` over them in JS. Modelled on `getProjectsList`'s
 * `assembleRows`: a single `inArray` role query regardless of how many projects
 * are asked for, no N+1.
 *
 * PERMISSIONS: **revenue only, and deliberately ungated.** `includeCost: false`
 * with an empty `openRoleCostUsd` means `computeProjectMargin` never costs a role —
 * `staff_employment` is never queried and `getProjectCostBasis` is never called, so
 * there is no compensation-derived figure here for `projects.viewMargin` to
 * protect. A bill rate and a plan's revenue are commercial terms about an
 * engagement, not personal data (ADR 0053 §7, ADR 0066 §9). Do **not** reach for
 * `getProjectsMarginContext()` to obtain the FX table: it also computes a cost
 * basis this has no use for.
 *
 * Rates arrive snapshotted on the role rows. Never add a `billRateFor` lookup to
 * this path — it would silently re-price historical plans (ADR 0066 §8).
 */
export async function getPlanRevenueByProject(
  billing: ReadonlyMap<string, MarginBilling>,
  displayCurrency: DisplayCurrency,
  usdRates: Record<Currency, number>,
): Promise<Map<string, PlanRevenue>> {
  const ids = [...billing.keys()];
  if (ids.length === 0) return new Map();

  const roleRows = await db
    .select({
      id: projectRoles.id,
      projectId: projectRoles.projectId,
      status: projectRoles.status,
      startDate: projectRoles.startDate,
      endDate: projectRoles.endDate,
      roleType: projectRoles.roleType,
      hoursPerDay: projectRoles.hoursPerDay,
      staffId: projectRoles.staffId,
      billRate: projectRoles.billRate,
    })
    .from(projectRoles)
    .where(inArray(projectRoles.projectId, ids));

  const rolesByProject = new Map<string, MarginRoleInput[]>();
  for (const row of roleRows) {
    const list = rolesByProject.get(row.projectId) ?? [];
    list.push({
      roleId: row.id,
      roleType: row.roleType,
      status: row.status,
      startDate: row.startDate,
      endDate: row.endDate,
      hoursPerDay: row.hoursPerDay,
      billRate: row.billRate,
      staffId: row.staffId,
      // No cost is read on this path — see the PERMISSIONS note above.
      staffHourlyCost: null,
    });
    rolesByProject.set(row.projectId, list);
  }

  const result = new Map<string, PlanRevenue>();
  for (const [projectId, projectBilling] of billing) {
    const { totals, countedRoleCount, convertedFrom } = computeProjectMargin({
      billing: projectBilling,
      roles: rolesByProject.get(projectId) ?? [],
      openRoleCostUsd: {},
      displayCurrency,
      usdRates,
      includeCost: false,
    });
    // Only a roles-derived total can be a fake zero — see `PlanRevenue.revenue`.
    const summedFromRoles = projectBilling.billingType === "TIME_AND_MATERIALS";
    result.set(projectId, {
      billingType: projectBilling.billingType,
      revenue:
        summedFromRoles && countedRoleCount === 0 ? null : totals.revenue,
      convertedFrom,
    });
  }

  return result;
}
