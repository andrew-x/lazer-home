"use client";

import { StatCard } from "@/components/stat-card";
import { ReportSection } from "@/components/utilization/report-primitives";
import {
  formatCount,
  formatHours,
  formatPercent,
  formatRate,
} from "@/lib/finance/finance-format";
import type { FinanceTotals } from "@/lib/finance/finance-report";
import {
  aggregateMoneyFormatters,
  type DisplayCurrency,
} from "@/lib/format/currency";
import { formatDateRange } from "@/lib/format/format";
import type { ReportRange } from "@/lib/reporting/report-range";

/**
 * The two headline bands: the reporting window, and the whole engagements behind
 * it.
 *
 * They are on **different time bases** and each says which — the discipline ADR
 * 0063 imposed on the home dashboard. "In period" is the slice of plan falling
 * inside the range, with a fixed fee prorated into it; "Overall" is the entire
 * plan of every project active in that range, most of which usually sits outside
 * it. A reader who mixed them up would conclude the portfolio had shrunk.
 */
export function FinanceSummaryCards({
  range,
  inPeriod,
  overall,
  currency,
  includesCost,
}: {
  range: ReportRange;
  inPeriod: FinanceTotals;
  overall: FinanceTotals;
  currency: DisplayCurrency;
  includesCost: boolean;
}) {
  return (
    <>
      <ReportSection
        title="In period"
        description={`Plan revenue and margin falling inside ${formatDateRange(range.start, range.end)}. A fixed fee is recognized in proportion to the billable hours delivered in the window.`}
        caption={partialityCaption(inPeriod, includesCost)}
      >
        <TotalsRow
          totals={inPeriod}
          currency={currency}
          includesCost={includesCost}
        />
      </ReportSection>

      <ReportSection
        title="Overall"
        description="The whole plan of every project active in that window, however far its dates run either side. Not a wider window — the same projects, measured end to end."
        caption={partialityCaption(overall, includesCost)}
      >
        <TotalsRow
          totals={overall}
          currency={currency}
          includesCost={includesCost}
        />
      </ReportSection>
    </>
  );
}

function TotalsRow({
  totals,
  currency,
  includesCost,
}: {
  totals: FinanceTotals;
  currency: DisplayCurrency;
  includesCost: boolean;
}) {
  const { money } = aggregateMoneyFormatters(currency);
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard
        label="Revenue"
        value={money(totals.revenue)}
        hint={`${formatCount(totals.projectCount)} projects · ${formatCount(totals.roleCount)} roles`}
      />
      <StatCard
        label="Margin"
        value={money(totals.margin)}
        hint={marginHint(totals, includesCost)}
      />
      <StatCard label="Cost" value={money(totals.cost)} />
      <StatCard
        label="Blended rate"
        value={formatRate(totals.blendedRate, currency)}
        hint="Revenue ÷ billable hours"
      />
      <StatCard label="Billable hours" value={formatHours(totals.hours)} />
    </div>
  );
}

/**
 * Why a margin figure reads the way it does. The three absent cases are genuinely
 * different, and collapsing them into one "—" would leave a reader unable to tell a
 * withheld figure from an unpriced portfolio.
 */
function marginHint(totals: FinanceTotals, includesCost: boolean): string {
  if (!includesCost) return "Cost withheld";
  if (totals.margin == null) return "No revenue or cost basis";
  if (totals.marginPercent == null) return "No revenue to compare against";
  return `${formatPercent(totals.marginPercent)} of revenue`;
}

/**
 * The fine print that keeps a **partial** total from reading as a small one.
 *
 * Both tallies describe figures that are absent rather than zero: a role with no
 * derivable cost is excluded from the cost total, and a project with no billing
 * type contributes no revenue at all. Neither is visible in the numbers
 * themselves, which is precisely why it is stated rather than left to be inferred.
 */
function partialityCaption(
  totals: FinanceTotals,
  includesCost: boolean,
): string | undefined {
  const notes: string[] = [];
  if (includesCost && totals.unknownCostRoleCount > 0) {
    notes.push(
      `${totals.unknownCostRoleCount} of ${totals.roleCount} roles have no derivable cost, so cost and margin are partial rather than lower`,
    );
  }
  if (totals.projectsWithoutBillingType > 0) {
    const n = totals.projectsWithoutBillingType;
    notes.push(
      `${n} project${n === 1 ? "" : "s"} ${n === 1 ? "has" : "have"} no billing type set and contribute no revenue`,
    );
  }
  if (notes.length === 0) return undefined;
  return `${notes.join("; ")}.`;
}
