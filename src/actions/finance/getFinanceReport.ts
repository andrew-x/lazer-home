import "server-only";

import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { getProjectCostBasis } from "@/actions/projects/getProjectCostBasis";
import { getExchangeRates } from "@/actions/staff/getExchangeRates";
import { getCurrentUser } from "@/lib/auth/auth";
import { requirePermission } from "@/lib/auth/permissions";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import { db } from "@/lib/db/db";
import { companies, projectRoles, projects } from "@/lib/db/schema";
import {
  buildFinanceReport,
  FINANCE_REPORT_ACCESS,
  type FinanceProjectInput,
  type FinanceReport,
} from "@/lib/finance/finance-report";
import {
  type Currency,
  DISPLAY_CURRENCIES,
  type DisplayCurrency,
} from "@/lib/format/currency";
import type { BillingType } from "@/lib/projects/project-billing";
import type { ProjectRoleStatus } from "@/lib/projects/project-role-status";
import type { ProjectRoleType } from "@/lib/projects/project-role-type";
import type { ReportRange } from "@/lib/reporting/report-range";
import { STAFF_FILTER_OPTIONS } from "@/lib/staff/staff-filters";

/** Filter option sets, re-exported so the page needn't import the schema. */
export const financeFilterOptions = STAFF_FILTER_OPTIONS;

export type FinanceReportData = {
  range: ReportRange;
  lineOfBusiness: LineOfBusiness | null;
  /**
   * The finished report in **both** display currencies, computed server-side.
   *
   * Not native amounts plus a rate table for the client to convert, which is what
   * a project's own budget panel ships (ADR 0029): a role's cost divided by its
   * hours *is* that person's hourly compensation, and a portfolio-wide payload
   * would put every assignee's pay rate in the page HTML at once. Two finished
   * reports are less payload than every role's cost anyway, and they mean the
   * currency toggle discloses nothing new — it picks between two aggregates that
   * were already safe to send. Same reasoning as `listMargin` in `getProjectsList`.
   */
  byCurrency: Record<DisplayCurrency, FinanceReport>;
  exchangeRates: Awaited<ReturnType<typeof getExchangeRates>>;
};

/** A project row and its roles, before cost is attached. */
type ProjectRows = {
  id: string;
  name: string;
  companyId: string;
  companyName: string;
  billingType: BillingType | null;
  budgetAmount: number | null;
  budgetCurrency: Currency | null;
  roles: RoleRow[];
};

type RoleRow = {
  id: string;
  status: ProjectRoleStatus;
  lineOfBusiness: LineOfBusiness;
  roleType: ProjectRoleType;
  startDate: string;
  endDate: string;
  hoursPerDay: number;
  billRate: number;
  staffId: string | null;
};

/**
 * The portfolio finance report: revenue, margin, blended rates and pricing
 * exposure over a window, optionally narrowed to one line of business.
 *
 * ── The gate ────────────────────────────────────────────────────────────────
 * `requirePermission(FINANCE_REPORT_ACCESS)` — i.e. `projects.viewMargin` — throws
 * rather than masking. Unlike `getProjectCostBasis`, which withholds cost so the
 * rest of a project page still renders, there is no useful remainder here: cost and
 * margin are half of what this page exists to say, so a masked version would be a
 * different report rather than a degraded one. The route 404s on the same check, so
 * this is defence in depth for a direct call.
 *
 * Cost inputs still come from `getProjectCostBasis`, which re-derives the same
 * decision — it is the one place that decision is made, and inlining its
 * `staff_employment` projection here to skip a redundant check would be the
 * beginning of a second answer to "may this viewer see cost".
 *
 * ── Filters bound the query, so both live in the URL ────────────────────────
 * The window bounds which projects are read at all; the line of business changes
 * which roles are counted and therefore how a fixed fee prorates. Both round-trip
 * (the utilization report filters an already-shipped projection in memory instead —
 * it can, because its projection carries nothing sensitive).
 *
 * ── Query shape ─────────────────────────────────────────────────────────────
 * Three queries plus the shared cost/FX reads, regardless of portfolio size. The
 * overlap predicate finds *which* projects were active in the window; the second
 * query then pulls **every** role on those projects, because the report's "overall"
 * column is the whole engagement and most of it usually sits outside the window.
 */
export async function getFinanceReport({
  range,
  lineOfBusiness,
}: {
  range: ReportRange;
  lineOfBusiness: LineOfBusiness | null;
}): Promise<FinanceReportData> {
  // A null user falls through to a default-deny role, so this can't leak.
  const user = await getCurrentUser();
  requirePermission(user ?? { role: null }, FINANCE_REPORT_ACCESS);

  const exchangeRates = await getExchangeRates();

  // Projects with at least one non-cancelled role overlapping the window. A
  // cancelled role will never be delivered or billed, so it cannot make a project
  // "active" — the same `countsTowardBudget` rule the money math applies, pushed
  // into SQL so a project made only of cancelled work is never fetched.
  const activeRows = await db
    .selectDistinct({ projectId: projectRoles.projectId })
    .from(projectRoles)
    .where(
      and(
        ne(projectRoles.status, "cancelled"),
        lte(projectRoles.startDate, range.end),
        gte(projectRoles.endDate, range.start),
      ),
    );
  const ids = activeRows.map((row) => row.projectId);

  const rows = ids.length === 0 ? [] : await loadProjectRows(ids);

  const staffIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.roles.flatMap((role) => (role.staffId ? [role.staffId] : [])),
      ),
    ),
  ];
  const costBasis = await getProjectCostBasis({
    staffIds,
    usdRates: exchangeRates.rates,
  });
  // `null` IS "may not see margin" — derived rather than assumed, even though the
  // gate above resolves the same capability.
  const includeCost = costBasis !== null;

  const inputs: FinanceProjectInput[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    companyId: row.companyId,
    companyName: row.companyName,
    billing: {
      billingType: row.billingType,
      budgetAmount: row.budgetAmount,
      budgetCurrency: row.budgetCurrency,
    },
    roles: row.roles.map((role) => ({
      roleId: role.id,
      roleType: role.roleType,
      status: role.status,
      lineOfBusiness: role.lineOfBusiness,
      startDate: role.startDate,
      endDate: role.endDate,
      hoursPerDay: role.hoursPerDay,
      billRate: role.billRate,
      staffId: role.staffId,
      // Absent for an open role, and for an assignee with no employment row —
      // which lands on UNKNOWN rather than being averaged, so a stranger's figure
      // never appears under a named person.
      staffHourlyCost:
        (role.staffId && costBasis?.staffHourlyCost[role.staffId]) || null,
    })),
  }));

  const byCurrency = Object.fromEntries(
    DISPLAY_CURRENCIES.map((displayCurrency) => [
      displayCurrency,
      buildFinanceReport({
        range,
        projects: inputs,
        openRoleCostUsd: costBasis?.openRoleCostUsd ?? {},
        displayCurrency,
        usdRates: exchangeRates.rates,
        includeCost,
        lineOfBusiness,
      }),
    ]),
  ) as Record<DisplayCurrency, FinanceReport>;

  return { range, lineOfBusiness, byCurrency, exchangeRates };
}

/**
 * The projects behind `ids` with every one of their roles — two concurrent queries,
 * grouped in memory. Cost is attached by the caller, once the whole assignee set is
 * known and one `getProjectCostBasis` call can resolve it.
 */
async function loadProjectRows(ids: string[]): Promise<ProjectRows[]> {
  const [baseRows, roleRows] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        companyId: projects.companyId,
        companyName: companies.name,
        billingType: projects.billingType,
        budgetAmount: projects.budgetAmount,
        budgetCurrency: projects.budgetCurrency,
      })
      .from(projects)
      .innerJoin(companies, eq(projects.companyId, companies.id))
      .where(inArray(projects.id, ids))
      .orderBy(asc(projects.name)),

    db
      .select({
        id: projectRoles.id,
        projectId: projectRoles.projectId,
        status: projectRoles.status,
        lineOfBusiness: projectRoles.lineOfBusiness,
        roleType: projectRoles.roleType,
        startDate: projectRoles.startDate,
        endDate: projectRoles.endDate,
        hoursPerDay: projectRoles.hoursPerDay,
        billRate: projectRoles.billRate,
        staffId: projectRoles.staffId,
      })
      .from(projectRoles)
      .where(inArray(projectRoles.projectId, ids)),
  ]);

  const rolesByProject = new Map<string, RoleRow[]>();
  for (const { projectId, ...role } of roleRows) {
    const list = rolesByProject.get(projectId) ?? [];
    list.push(role);
    rolesByProject.set(projectId, list);
  }

  return baseRows.map((row) => ({
    ...row,
    roles: rolesByProject.get(row.id) ?? [],
  }));
}
