import "server-only";

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
  type ExchangeRates,
  getExchangeRates,
} from "@/actions/staff/getExchangeRates";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import { opportunities, projectRoles, projects, staff } from "@/lib/db/schema";
import type { Currency } from "@/lib/format/currency";
import {
  type DeliveryManagerSummary,
  deliveryManagersOf,
} from "@/lib/projects/delivery-coverage";
import type { BillingType } from "@/lib/projects/project-billing";
import {
  deriveProjectLinesOfBusiness,
  deriveProjectStatus,
} from "@/lib/projects/project-derived";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import { getProjectCostBasis, type PlanCostBasis } from "./getProjectCostBasis";

/** One staffing line on the opportunity's project, shaped for the planner. */
export type PlanRole = {
  id: string;
  staffId: string | null;
  staffName: string | null;
  lineOfBusiness: LineOfBusiness;
  description: string | null;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  // The opportunity that created the role — the planner greys roles from other
  // opportunities and lets you edit only this opportunity's tentative ones.
  opportunityId: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  // The rate this line bills at, in `BILL_RATE_CURRENCY`. Snapshotted from the rate
  // card when the role was created, so it may differ from today's card — which is
  // what the roles list flags as "off standard rate". Non-nullable: the column is
  // NOT NULL, and making it required here is the compiler pressure that stops a
  // plan reader forgetting to select it.
  billRate: number;
};

/**
 * A staffing line one of this project's people holds on **another** project,
 * shaped for the planner. Assigning someone here surfaces their commitments
 * elsewhere (greyed) so an over-allocation is visible while planning this deal.
 */
export type ExternalAllocation = {
  staffId: string;
  roleId: string;
  projectName: string;
  roleType: ProjectRoleType;
  status: ProjectRoleStatus;
  lineOfBusiness: LineOfBusiness;
  description: string | null;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  // Deliberately NO `billRate`: another project's role is never priced on this
  // planner — it appears only to show that someone's capacity is already committed.
  // `billRateFor` would happily accept this shape, so don't add one.
};

/**
 * How a project bills. `billingType: null` means no budget was ever set — a real,
 * permanent state for every project created before budgets existed, which the UI
 * renders as "No budget set".
 *
 * There are no rates here: a rate is a property of each role (`PlanRole.billRate`),
 * not of the project's billing model.
 */
export type PlanBudget = {
  billingType: BillingType | null;
  /** The total fee. Set only for FIXED_FEE. */
  budgetAmount: number | null;
  budgetCurrency: Currency | null;
};

export type PlanProject = {
  id: string;
  name: string;
  /** Derived from the project's roles (see `project-derived.ts`). */
  status: ProjectRoleStatus;
  /** The distinct lines of business across the project's roles. */
  linesOfBusiness: LineOfBusiness[];
  /**
   * The staff who run this project — *derived* from the people on its live
   * `DELIVERY` roles, so it is read-only wherever it's shown. Each carries the
   * spans they run. See `@/lib/projects/delivery-coverage`.
   */
  deliveryManagers: DeliveryManagerSummary[];
  /** How this project bills. */
  budget: PlanBudget;
};

export type OpportunityPlan = {
  /** The project delivering this opportunity, or null if none is linked yet. */
  project: PlanProject | null;
  /** Every role on that project (all opportunities), for the planner grid. */
  roles: PlanRole[];
  /** The overall span across all roles, or null when there are no roles. */
  timeline: { start: string; end: string } | null;
  roleCount: number;
  /**
   * Roles the staffed people here hold on **other** projects (tentative or
   * confirmed), for the greyed "other commitments" blocks. Empty when no one is
   * staffed yet.
   */
  externalAllocations: ExternalAllocation[];
  /**
   * Cost inputs for the margin computation, or **null** when the viewer lacks
   * `projects.viewMargin`. Withheld here in the read, not hidden in the UI — see
   * `getProjectCostBasis`.
   */
  costBasis: PlanCostBasis | null;
  /**
   * USD-based FX table plus its `asOf`/`stale` provenance, so the client can
   * convert every figure into the chosen display currency and flag the ones that
   * needed a rate (ADR 0029).
   */
  exchangeRates: ExchangeRates;
};

/**
 * The planner read for an opportunity's associated project: project meta plus
 * **every** role on it (across all opportunities), each carrying its status and
 * originating opportunity so the client can render this opportunity's tentative
 * roles as editable and everything else (confirmed, or other opportunities')
 * greyed. Returns null only if the opportunity itself is unknown; an opportunity
 * with no project returns an empty plan. Reads go through the actions layer.
 */
export async function getOpportunityPlan(
  opportunityId: string,
): Promise<OpportunityPlan | null> {
  const [opportunity] = await db
    .select({ projectId: opportunities.projectId })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .limit(1);

  if (!opportunity) return null;

  // Fetched up front so every return path carries it. A 12h-cached `fetch` that
  // never throws (it falls back to approximate rates and says so), so this is
  // effectively free even on the empty-plan paths.
  const exchangeRates = await getExchangeRates();

  /** An opportunity with no project: nothing to plan, price, or cost. */
  const emptyPlan = (): OpportunityPlan => ({
    project: null,
    roles: [],
    timeline: null,
    roleCount: 0,
    externalAllocations: [],
    costBasis: null,
    exchangeRates,
  });

  if (!opportunity.projectId) return emptyPlan();

  const [projectRow] = await db
    .select({
      id: projects.id,
      name: projects.name,
      billingType: projects.billingType,
      budgetAmount: projects.budgetAmount,
      budgetCurrency: projects.budgetCurrency,
    })
    .from(projects)
    .where(eq(projects.id, opportunity.projectId))
    .limit(1);

  if (!projectRow) {
    // The FK guarantees this shouldn't happen, but treat a vanished project as
    // an empty plan rather than throwing.
    return emptyPlan();
  }

  // All roles for the project in one query. Left join staff (staffId is
  // nullable — placeholders survive).
  const roles: PlanRole[] = await db
    .select({
      id: projectRoles.id,
      staffId: projectRoles.staffId,
      staffName: staff.name,
      lineOfBusiness: projectRoles.lineOfBusiness,
      description: projectRoles.description,
      roleType: projectRoles.roleType,
      status: projectRoles.status,
      opportunityId: projectRoles.opportunityId,
      startDate: projectRoles.startDate,
      endDate: projectRoles.endDate,
      hoursPerDay: projectRoles.hoursPerDay,
      billRate: projectRoles.billRate,
    })
    .from(projectRoles)
    .leftJoin(staff, eq(projectRoles.staffId, staff.id))
    .where(eq(projectRoles.projectId, projectRow.id))
    .orderBy(asc(projectRoles.startDate));

  // The other-project commitments of everyone staffed on this project, so the
  // planner can grey them in behind this deal's roles. Same status filter as the
  // allocations grid; other projects only (same-project roles are their own rows).
  const staffIds = [
    ...new Set(roles.flatMap((r) => (r.staffId ? [r.staffId] : []))),
  ];
  const externalAllocations: ExternalAllocation[] = staffIds.length
    ? (
        await db
          .select({
            staffId: projectRoles.staffId,
            roleId: projectRoles.id,
            projectName: projects.name,
            roleType: projectRoles.roleType,
            status: projectRoles.status,
            lineOfBusiness: projectRoles.lineOfBusiness,
            description: projectRoles.description,
            startDate: projectRoles.startDate,
            endDate: projectRoles.endDate,
            hoursPerDay: projectRoles.hoursPerDay,
          })
          .from(projectRoles)
          .innerJoin(projects, eq(projectRoles.projectId, projects.id))
          .where(
            and(
              inArray(projectRoles.staffId, staffIds),
              ne(projectRoles.projectId, projectRow.id),
              inArray(projectRoles.status, ["tentative", "confirmed"]),
            ),
          )
          .orderBy(asc(projectRoles.startDate))
      ).map((r) => ({ ...r, staffId: r.staffId as string }))
    : [];

  // Overall span — ISO date strings sort lexically, so min/max are string
  // reductions. Null when the project has no roles yet.
  let timeline: { start: string; end: string } | null = null;
  for (const role of roles) {
    if (!timeline) {
      timeline = { start: role.startDate, end: role.endDate };
      continue;
    }
    if (role.startDate < timeline.start) timeline.start = role.startDate;
    if (role.endDate > timeline.end) timeline.end = role.endDate;
  }

  const costBasis = await getProjectCostBasis({
    staffIds,
    usdRates: exchangeRates.rates,
  });

  return {
    project: {
      id: projectRow.id,
      name: projectRow.name,
      // Status, lines of business and delivery managers are all derived from the
      // roles already in hand — no project column, and no extra query.
      status: deriveProjectStatus(roles.map((r) => r.status)),
      linesOfBusiness: deriveProjectLinesOfBusiness(
        roles.map((r) => r.lineOfBusiness),
      ),
      deliveryManagers: deliveryManagersOf(roles),
      budget: {
        billingType: projectRow.billingType,
        budgetAmount: projectRow.budgetAmount,
        budgetCurrency: projectRow.budgetCurrency,
      },
    },
    roles,
    timeline,
    roleCount: roles.length,
    externalAllocations,
    costBasis,
    exchangeRates,
  };
}
