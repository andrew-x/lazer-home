import "server-only";

import { and, eq, gte, inArray } from "drizzle-orm";
import { getPlanRevenueByProject } from "@/actions/projects/getPlanRevenueByProject";
import { getCurrentStaffId } from "@/actions/staff/getCurrentStaffId";
import {
  type ExchangeRates,
  getExchangeRates,
} from "@/actions/staff/getExchangeRates";
import {
  CLOSED_OPPORTUNITY_STATUSES,
  type OpportunityStatus,
} from "@/lib/crm/opportunity";
import { db } from "@/lib/db/db";
import {
  companies,
  opportunities,
  opportunityOwners,
  projects,
} from "@/lib/db/schema";
import {
  CURRENCY,
  type Currency,
  type DisplayCurrency,
} from "@/lib/format/currency";
import { formatIsoDate, parseIsoDate } from "@/lib/format/format";
import {
  type ClosedWindows,
  FUNNEL_STATUSES,
  groupMyDealsByStage,
  type MyPipelineStage,
  PIPELINE_DISPLAY_CURRENCY,
  summarizeClosed,
} from "@/lib/home/pipeline";
import type { BillingType } from "@/lib/projects/project-billing";
import type { MarginBilling } from "@/lib/projects/project-margin";
import {
  addDays,
  currentDay,
  currentMonthStart,
  currentWeekStart,
} from "@/lib/timesheets/timesheet-week";
import { openTasksByParent } from "./getTasks";

/** One open task on a deal you own — its "next step". */
export type MyDealNextStep = {
  id: string;
  description: string;
};

/**
 * One deal you own, as the home dashboard's personal pipeline renders it.
 *
 * **This type is a whitelist**, the same rule `MyTaskView` documents. It renders
 * from a Server Component today, so nothing here crosses a serialization boundary
 * — the field-by-field copy in {@link toMyDealView} stays anyway, because this is
 * one `"use client"` directive away from being a disclosure boundary, and that is
 * exactly how `MyTaskView`'s rule came to be written. Never spread into it.
 *
 * `MyDealNextStep` narrows `OpenTaskSummary`: `ownerId` / `ownerName` are dropped
 * because every task reaching here is already assigned to the viewer.
 */
export type MyDealView = {
  opportunityId: string;
  name: string;
  companyName: string;
  status: OpportunityStatus;
  /**
   * The linked project's plan value in `displayCurrency`; null when it can't be
   * priced. Deliberately the **whole project's** plan revenue, matching what this
   * deal's own plan drawer shows — so two of your deals on one project each report
   * that project's value. That's why the UI calls this "project plan value" and not
   * "deal value": the org band totals count a shared project once, and the two
   * figures would otherwise silently use one word for two definitions. See
   * docs/decisions/0069.
   */
  value: number | null;
  billingType: BillingType | null;
  /** Its open tasks, oldest first (`openTasksByParent`'s order). */
  nextSteps: MyDealNextStep[];
};

export type MyPipelineView = {
  /** Non-empty funnel stages in pipeline order. Excludes Maturing. */
  stages: MyPipelineStage<MyDealView>[];
  /** Your own deals decided this week and this month. */
  closed: ClosedWindows;
  displayCurrency: DisplayCurrency;
  convertedFrom: Currency[];
  rates: ExchangeRates;
  today: string;
  weekStart: string;
  monthStart: string;
};

/**
 * The signed-in person's own sales pipeline for the home dashboard's "Your Status"
 * band: the open deals they own (via `opportunity_owners`) grouped by stage with
 * each one's plan value and next steps, plus their own won/lost counts for this
 * week and this month.
 *
 * PERMISSIONS: **own-data-only by construction.** Takes no id — the subject is
 * resolved from the session via `getCurrentStaffId`, so there is no cross-user id
 * to authorize and therefore no gate to get wrong (the `getMyTasks` /
 * `getMyAllocations` pattern). An account with no staff record gets the empty view,
 * not an error. The money is plan revenue only; no cost is read (see
 * `getPlanRevenueByProject`), so `projects.viewMargin` is not in play and
 * `permissions.ts` is deliberately unchanged.
 *
 * Four DB queries plus the request-shared 12h-cached FX `fetch`.
 */
export async function getMyPipeline(): Promise<MyPipelineView> {
  const today = currentDay();
  const weekStart = currentWeekStart();
  const monthStart = currentMonthStart();

  const staffId = await getCurrentStaffId();
  if (!staffId) {
    return {
      stages: [],
      closed: { week: { won: 0, lost: 0 }, month: { won: 0, lost: 0 } },
      displayCurrency: PIPELINE_DISPLAY_CURRENCY,
      convertedFrom: [],
      rates: await getExchangeRates(),
      today,
      weekStart,
      monthStart,
    };
  }

  // A Monday-start week can begin in the previous month, so bound on the earlier
  // of the two; one day of slack because `closedAt` is a zone-less timestamp and
  // `summarizeClosed` is the authority (see `getOrgPipeline` for the full note).
  const windowStart = weekStart < monthStart ? weekStart : monthStart;
  const closedBound = parseIsoDate(addDays(windowStart, -1));

  const [openRows, closedRows, rates] = await Promise.all([
    db
      .select({
        opportunityId: opportunities.id,
        name: opportunities.name,
        companyName: companies.name,
        status: opportunities.status,
        projectId: opportunities.projectId,
        billingType: projects.billingType,
        budgetAmount: projects.budgetAmount,
        budgetCurrency: projects.budgetCurrency,
      })
      .from(opportunityOwners)
      .innerJoin(
        opportunities,
        eq(opportunityOwners.opportunityId, opportunities.id),
      )
      .innerJoin(companies, eq(opportunities.companyId, companies.id))
      .leftJoin(projects, eq(opportunities.projectId, projects.id))
      .where(
        and(
          eq(opportunityOwners.staffId, staffId),
          inArray(opportunities.status, [...FUNNEL_STATUSES]),
        ),
      ),

    db
      .select({
        status: opportunities.status,
        closedAt: opportunities.closedAt,
      })
      .from(opportunityOwners)
      .innerJoin(
        opportunities,
        eq(opportunityOwners.opportunityId, opportunities.id),
      )
      .where(
        and(
          eq(opportunityOwners.staffId, staffId),
          inArray(opportunities.status, [...CLOSED_OPPORTUNITY_STATUSES]),
          gte(opportunities.closedAt, closedBound),
        ),
      ),

    getExchangeRates(),
  ]);

  // Every stage shows a size here, not just Mid and Bottom, so all of your deals'
  // projects get priced. A project shared by two of your deals appears once.
  const billing = new Map<string, MarginBilling>();
  for (const row of openRows) {
    if (!row.projectId) continue;
    billing.set(row.projectId, {
      billingType: row.billingType,
      budgetAmount: row.budgetAmount,
      budgetCurrency: row.budgetCurrency,
    });
  }

  const [revenueByProject, nextStepsByDeal] = await Promise.all([
    getPlanRevenueByProject(billing, PIPELINE_DISPLAY_CURRENCY, rates.rates),
    openTasksByParent(
      "opportunity",
      openRows.map((row) => row.opportunityId),
    ),
  ]);

  const converted = new Set<Currency>();
  for (const plan of revenueByProject.values()) {
    for (const currency of plan.convertedFrom) converted.add(currency);
  }

  /** Copies field by field — never spread. See {@link MyDealView}. */
  const toMyDealView = (row: (typeof openRows)[number]): MyDealView => {
    const plan = row.projectId
      ? revenueByProject.get(row.projectId)
      : undefined;
    return {
      opportunityId: row.opportunityId,
      name: row.name,
      companyName: row.companyName,
      status: row.status,
      value: plan?.revenue ?? null,
      billingType: row.billingType,
      nextSteps: (nextStepsByDeal.get(row.opportunityId) ?? []).map((task) => ({
        id: task.id,
        description: task.description,
      })),
    };
  };

  return {
    stages: groupMyDealsByStage(openRows.map(toMyDealView)),
    closed: summarizeClosed(
      closedRows
        // Non-null for every closed status (`opportunities_closed_at_shape`).
        .filter((row) => row.closedAt !== null)
        .map((row) => ({
          status: row.status,
          closedOn: formatIsoDate(row.closedAt as Date),
        })),
      weekStart,
      monthStart,
    ),
    displayCurrency: PIPELINE_DISPLAY_CURRENCY,
    convertedFrom: CURRENCY.filter((code) => converted.has(code)),
    rates,
    today,
    weekStart,
    monthStart,
  };
}
