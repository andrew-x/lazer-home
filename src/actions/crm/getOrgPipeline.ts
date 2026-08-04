import "server-only";

import { and, eq, gte, inArray } from "drizzle-orm";
import { getPlanRevenueByProject } from "@/actions/projects/getPlanRevenueByProject";
import {
  type ExchangeRates,
  getExchangeRates,
} from "@/actions/staff/getExchangeRates";
import {
  LINE_OF_BUSINESS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import { CLOSED_OPPORTUNITY_STATUSES } from "@/lib/crm/opportunity";
import { db } from "@/lib/db/db";
import { opportunities, projects } from "@/lib/db/schema";
import {
  CURRENCY,
  type Currency,
  type DisplayCurrency,
} from "@/lib/format/currency";
import { formatIsoDate, parseIsoDate } from "@/lib/format/format";
import {
  type ClosedDeal,
  FUNNEL_STATUSES,
  type FunnelDeal,
  PIPELINE_DISPLAY_CURRENCY,
  type PipelineSummary,
  type ProjectValue,
  summarizePipeline,
  VALUED_FUNNEL_STATUSES,
} from "@/lib/home/pipeline";
import type { MarginBilling } from "@/lib/projects/project-margin";
import {
  addDays,
  currentDay,
  currentMonthStart,
  currentWeekStart,
} from "@/lib/timesheets/timesheet-week";

/**
 * The company-wide sales pipeline for the home dashboard's "Lazer Status" band:
 * open deals folded into three funnel bands with their plan value, plus the deals
 * won and lost this week and this month.
 *
 * ## Pre-folded per filter value, deliberately
 *
 * This is the prop of a Client Component (`LazerStatusSection`), so everything it
 * returns is serialized into the page HTML for every viewer. The panel renders no
 * per-deal row at all — only counts and band totals — so unlike `OrgPerson` there
 * is nothing here to itemize. Shipping one small summary per line of business plus
 * one for "all" means **no deal name, company name, owner name, opportunity id,
 * project id or per-project figure ever crosses the boundary**, and it satisfies
 * ADR 0063 §6 ("a filtered count must be recomputed, never reuse the server's
 * unfiltered total") *by construction*: every filter state has its own fold, from
 * the same rows, by the same function. Don't "simplify" this into shipping deal
 * rows for the client to re-fold — `pipeline.test.ts` asserts the omissions
 * against the serialized payload and will fail if you do.
 *
 * ## PERMISSIONS — no gate, and no matrix change
 *
 * Read parity with `getOpportunitiesPage` / `getOpportunitiesBoard`: CRM reads
 * aren't gated per-capability, only by the authenticated `(app)` layout. The money
 * here is plan **revenue**, which is ungated by ADR 0053 §7 / 0066 §9 — cost and
 * margin are gated because a role's cost *is* an individual's compensation, while a
 * bill rate and a plan's revenue are commercial terms about an engagement. No cost
 * is read at all on this path (see `getPlanRevenueByProject`).
 *
 * `permissions.ts`, `permissions.test.ts` and `docs/domains/permissions.md` are
 * therefore deliberately **untouched** — stated here so an `/audit-rbac` pass reads
 * the omission as a decision rather than an oversight. See docs/decisions/0069.
 *
 * Three DB queries plus one 12h-cached `fetch`, regardless of pipeline size.
 */
export type OrgPipeline = {
  /** Folded over every open funnel deal, whatever its line of business. */
  all: PipelineSummary;
  /** The same fold restricted to each line of business. */
  byLineOfBusiness: Record<LineOfBusiness, PipelineSummary>;
  /** The currency every money figure above is already expressed in. */
  displayCurrency: DisplayCurrency;
  /** Currencies an FX rate was applied to, in canonical order. Often empty. */
  convertedFrom: Currency[];
  /** `asOf` / `stale` provenance for the `FxRateNote`. Public market data. */
  rates: ExchangeRates;
  /** The three instants the figures describe, so the UI can label each block. */
  today: string;
  weekStart: string;
  monthStart: string;
};

/** Membership test for the statuses whose plans need pricing. */
const VALUED: ReadonlySet<string> = new Set(VALUED_FUNNEL_STATUSES);

export async function getOrgPipeline(): Promise<OrgPipeline> {
  const today = currentDay();
  const weekStart = currentWeekStart();
  const monthStart = currentMonthStart();

  // A Monday-start week can begin in the PREVIOUS month, so the two windows are
  // not nested and the bound is the earlier of the two — not `monthStart`.
  const windowStart = weekStart < monthStart ? weekStart : monthStart;
  // One day of slack: `closedAt` is a plain `timestamp` and this bound is a JS
  // `Date` at local midnight, so a driver/session timezone skew could otherwise
  // *exclude* a row closed early on the boundary day. `summarizeClosed` re-buckets
  // from each row's own ISO day, so the fold is authoritative and this can only
  // over-fetch by hours — never mis-file a figure. Don't tighten it.
  const closedBound = parseIsoDate(addDays(windowStart, -1));

  const [openRows, closedRows, rates] = await Promise.all([
    // Open funnel deals, with their linked project's billing carried on the row —
    // which is why `getPlanRevenueByProject` needs no `projects` query of its own.
    db
      .select({
        status: opportunities.status,
        lineOfBusiness: opportunities.lineOfBusiness,
        projectId: opportunities.projectId,
        billingType: projects.billingType,
        budgetAmount: projects.budgetAmount,
        budgetCurrency: projects.budgetCurrency,
      })
      .from(opportunities)
      .leftJoin(projects, eq(opportunities.projectId, projects.id))
      .where(inArray(opportunities.status, [...FUNNEL_STATUSES])),

    db
      .select({
        status: opportunities.status,
        lineOfBusiness: opportunities.lineOfBusiness,
        closedAt: opportunities.closedAt,
      })
      .from(opportunities)
      .where(
        and(
          inArray(opportunities.status, [...CLOSED_OPPORTUNITY_STATUSES]),
          gte(opportunities.closedAt, closedBound),
        ),
      ),

    getExchangeRates(),
  ]);

  // Only the bands that report money need a plan priced — Top of funnel doesn't,
  // so its projects are left out of the role scan entirely.
  const billing = new Map<string, MarginBilling>();
  for (const row of openRows) {
    if (!row.projectId || !VALUED.has(row.status)) continue;
    // A project shared by several deals repeats its billing across rows; the Map
    // dedupes it.
    billing.set(row.projectId, {
      billingType: row.billingType,
      budgetAmount: row.budgetAmount,
      budgetCurrency: row.budgetCurrency,
    });
  }

  const revenueByProject = await getPlanRevenueByProject(
    billing,
    PIPELINE_DISPLAY_CURRENCY,
    rates.rates,
  );

  const valueByProject = new Map<string, ProjectValue>();
  const converted = new Set<Currency>();
  for (const [projectId, plan] of revenueByProject) {
    valueByProject.set(projectId, {
      billingType: plan.billingType,
      revenue: plan.revenue,
    });
    for (const currency of plan.convertedFrom) converted.add(currency);
  }

  const open: (FunnelDeal & { lineOfBusiness: LineOfBusiness })[] =
    openRows.map((row) => ({
      status: row.status,
      projectId: row.projectId,
      lineOfBusiness: row.lineOfBusiness,
    }));
  const closed: (ClosedDeal & { lineOfBusiness: LineOfBusiness })[] = closedRows
    // The column is non-null for every closed status (`opportunities_closed_at_shape`),
    // so this narrows the type without discarding rows in practice.
    .filter((row) => row.closedAt !== null)
    .map((row) => ({
      status: row.status,
      closedOn: formatIsoDate(row.closedAt as Date),
      lineOfBusiness: row.lineOfBusiness,
    }));

  const fold = (lineOfBusiness: LineOfBusiness | null): PipelineSummary =>
    summarizePipeline(
      lineOfBusiness === null
        ? open
        : open.filter((d) => d.lineOfBusiness === lineOfBusiness),
      valueByProject,
      lineOfBusiness === null
        ? closed
        : closed.filter((d) => d.lineOfBusiness === lineOfBusiness),
      weekStart,
      monthStart,
    );

  return {
    all: fold(null),
    byLineOfBusiness: Object.fromEntries(
      LINE_OF_BUSINESS.map((lob) => [lob, fold(lob)]),
    ) as Record<LineOfBusiness, PipelineSummary>,
    displayCurrency: PIPELINE_DISPLAY_CURRENCY,
    convertedFrom: CURRENCY.filter((code) => converted.has(code)),
    rates,
    today,
    weekStart,
    monthStart,
  };
}
