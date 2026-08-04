"use client";

import { EmptyState } from "@/components/empty-state";
import { InlineNotice } from "@/components/inline-notice";
import { ROOMY_TABLE } from "@/components/table-density";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportSection } from "@/components/utilization/report-primitives";
import { formatHours, formatRate } from "@/lib/finance/finance-format";
import type {
  DisciplineRate,
  FinanceTotals,
} from "@/lib/finance/finance-report";
import type { DisplayCurrency } from "@/lib/format/currency";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

/**
 * Average rates over the window, overall and per discipline.
 *
 * **Two rate columns, not one, and the difference is load-bearing.** A discipline's
 * *card rate* is the hours-weighted mean of what its roles say they bill at, which
 * is defined for every role on the plan. Its *blended* rate is revenue ÷ hours,
 * which is only a fact for time-and-materials work: a fixed fee is one price for a
 * whole engagement and splitting it across the disciplines that delivered it would
 * invent a number (ADR 0066). So `blended` is null wherever a discipline's hours are
 * all fixed-fee, and the hours it does cover are shown beside it.
 *
 * The overall blended rate in the footer has no such problem — at portfolio level a
 * fee *is* revenue and the hours behind it are known.
 */
export function FinanceRatesTable({
  rates,
  inPeriodTotals,
  currency,
}: {
  rates: DisciplineRate[];
  inPeriodTotals: FinanceTotals;
  currency: DisplayCurrency;
}) {
  const fixedFeeOnly = rates.filter(
    (row) => row.timeAndMaterialsHours === 0,
  ).length;

  return (
    <ReportSection
      title="Average rates"
      description="What an hour bills at in this period — as the roles are priced, and as the money actually lands."
      caption="Card rate is the hours-weighted mean of each role's own stored rate. Blended is revenue ÷ hours, so it reflects a fixed fee's real recovery."
    >
      {rates.length === 0 ? (
        <EmptyState bordered>
          No billable hours fell inside this period.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded border">
            <Table className={ROOMY_TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead>Discipline</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead className="text-right">Card rate</TableHead>
                  <TableHead className="text-right">Blended rate</TableHead>
                  <TableHead className="text-right">T&M hours</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rates.map((row) => (
                  <TableRow key={row.roleType}>
                    <TableCell className="font-medium">
                      {PROJECT_ROLE_TYPE_LABELS[row.roleType]}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatHours(row.hours)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(row.cardRate, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(row.blended, currency)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatHours(row.timeAndMaterialsHours)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>All disciplines</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHours(inPeriodTotals.hours)}
                  </TableCell>
                  {/* No overall card rate: a mean of per-discipline means would be
                      a different figure from the mean of the roles, and nobody
                      wants either at portfolio level. The blended rate is the one
                      that means something across a whole book. */}
                  <TableCell className="text-right text-muted-foreground">
                    —
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatRate(inPeriodTotals.blendedRate, currency)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {fixedFeeOnly > 0 ? (
            <InlineNotice>
              <p>
                {fixedFeeOnly} discipline{fixedFeeOnly === 1 ? "" : "s"} show no
                blended rate: all their hours in this period sit on fixed-fee
                projects, and one fee cannot be split across the disciplines
                that delivered it without inventing the split. Their card rate
                still applies, and the fee's real recovery shows in the overall
                blended rate.
              </p>
            </InlineNotice>
          ) : null}
        </div>
      )}
    </ReportSection>
  );
}
