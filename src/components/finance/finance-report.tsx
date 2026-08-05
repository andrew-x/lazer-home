"use client";

import { useState } from "react";
import type { FinanceReportData } from "@/actions/finance/getFinanceReport";
import { FinanceFilters } from "@/components/finance/finance-filters";
import { FinancePricingCards } from "@/components/finance/finance-pricing-cards";
import { FinanceProjectsTable } from "@/components/finance/finance-projects-table";
import { FinanceRatesTable } from "@/components/finance/finance-rates-table";
import { FinanceSummaryCards } from "@/components/finance/finance-summary-cards";
import { FxRateNote } from "@/components/fx-rate-note";
import { InlineNotice } from "@/components/inline-notice";
import type { DisplayCurrency } from "@/lib/format/currency";

/**
 * The finance report's client shell.
 *
 * It holds exactly one piece of state — the display currency — and every block
 * below reads from `data.byCurrency[currency]`, a report the server already
 * finished. Nothing is recomputed here: the aggregation runs on the server so no
 * per-person cost has to reach the browser (see `getFinanceReport`), which also
 * means the toggle is a pure display choice and cannot disclose anything the page
 * hadn't already sent.
 *
 * CAD is the default, matching `MARGIN_FLAG_CURRENCY` and the compensation
 * dashboards, so the figure a reader sees first is the one the projects list
 * already evaluated its low-margin flags in.
 */
export function FinanceReport({
  data,
  today,
  lineOfBusinessOptions,
}: {
  data: FinanceReportData;
  today: string;
  lineOfBusinessOptions: readonly string[];
}) {
  const [currency, setCurrency] = useState<DisplayCurrency>("CAD");
  const report = data.byCurrency[currency];

  return (
    <div className="flex flex-col gap-6">
      <FinanceFilters
        range={data.range}
        today={today}
        lineOfBusinessOptions={lineOfBusinessOptions}
        lineOfBusiness={data.lineOfBusiness}
        currency={currency}
        onCurrencyChange={setCurrency}
      />

      <div className="flex flex-col gap-1">
        <InlineNotice>
          <p>
            Every figure here comes from the <strong>plan</strong> — each role's
            rate over the weekdays it covers — not from invoices or logged time.
            A time entry records hours against a project, never against the role
            that prices them, so nothing in this app can price time actually
            worked. Read these as what the book is committed to bill, not as
            revenue recognised.
          </p>
        </InlineNotice>
        <FxRateNote
          rates={data.exchangeRates}
          from={report.convertedFrom}
          to={currency}
        />
      </div>

      <FinanceSummaryCards
        range={report.range}
        inPeriod={report.inPeriod}
        overall={report.overall}
        currency={currency}
        includesCost={report.includesCost}
      />

      <FinanceProjectsTable
        projects={report.projects}
        inPeriodTotals={report.inPeriod}
        currency={currency}
      />

      <FinanceRatesTable
        rates={report.rates}
        inPeriodTotals={report.inPeriod}
        currency={currency}
      />

      <FinancePricingCards
        fixedFee={report.fixedFee}
        offStandard={report.offStandard}
        currency={currency}
      />
    </div>
  );
}
