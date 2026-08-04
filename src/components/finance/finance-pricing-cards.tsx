"use client";

import { StatCard } from "@/components/stat-card";
import { ReportSection } from "@/components/utilization/report-primitives";
import {
  formatCount,
  formatHours,
  formatMoneyDelta,
  formatPercent,
  formatPercentDelta,
} from "@/lib/finance/finance-format";
import type {
  FixedFeeRollup,
  OffStandardExposure,
} from "@/lib/finance/finance-report";
import {
  aggregateMoneyFormatters,
  type DisplayCurrency,
} from "@/lib/format/currency";
import { BILL_RATES_REVIEWED_ON } from "@/lib/projects/bill-rates";

/**
 * How the book is priced: what the fixed-fee half recovers against hourly rates,
 * and how much of it rides on rates that no longer match the card.
 *
 * **Neither figure is coloured.** A fee negotiated below role rates is a commercial
 * decision, not a loss (ADR 0066), and an off-card rate is as often a card revision
 * as a discount. Tinting either would assert a judgement the numbers don't support —
 * the same reason the project budget panel leaves its comparator uncoloured.
 */
export function FinancePricingCards({
  fixedFee,
  offStandard,
  currency,
}: {
  fixedFee: FixedFeeRollup;
  offStandard: OffStandardExposure;
  currency: DisplayCurrency;
}) {
  const { money } = aggregateMoneyFormatters(currency);

  return (
    <ReportSection
      title="Pricing"
      description="What the fixed-fee book recovers against the same roles priced hourly, and how much revenue sits on rates that differ from the current card."
      caption={`Standard rates were last reviewed ${BILL_RATES_REVIEWED_ON}. Because a rate is snapshotted onto a role when it is created, "off standard" covers both a negotiated rate and a role still carrying the previous card price — stale prices are the failure mode worth surfacing.`}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Fixed fee in period"
          value={money(fixedFee.revenue)}
          hint={
            fixedFee.projectCount === 0
              ? "No fixed-fee projects in this period"
              : `${formatCount(fixedFee.projectCount)} project${fixedFee.projectCount === 1 ? "" : "s"}`
          }
        />
        <StatCard
          label="Same roles hourly"
          value={money(fixedFee.hourlyValue)}
          hint="Those roles at their own stored rates"
        />
        <StatCard
          label="Discount / premium"
          value={formatMoneyDelta(fixedFee.delta, currency)}
          hint={
            fixedFee.delta == null
              ? "Nothing to compare"
              : `${formatPercentDelta(fixedFee.deltaPercent)} against role rates`
          }
        />
        <StatCard
          label="Off standard rate"
          value={formatPercent(offStandard.share)}
          hint={
            offStandard.roleCount === 0
              ? "Every role is on the current card"
              : `${formatCount(offStandard.roleCount)} roles · ${formatHours(offStandard.hours)} · ${money(offStandard.amountAtRoleRates)} at role rates`
          }
        />
      </div>
    </ReportSection>
  );
}
