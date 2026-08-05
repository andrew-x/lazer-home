"use client";

import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
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
import { cn } from "@/lib/core/utils";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatHours, formatPercent } from "@/lib/finance/finance-format";
import type {
  FinanceTotals,
  ProjectFinance,
} from "@/lib/finance/finance-report";
import {
  aggregateMoneyFormatters,
  type DisplayCurrency,
} from "@/lib/format/currency";
import { formatDateRange } from "@/lib/format/format";
import { BILLING_TYPE_LABELS } from "@/lib/projects/project-billing";
import { marginAmountTone } from "@/lib/projects/project-margin";

/**
 * Every project active in the window, with its money on both time bases.
 *
 * The in-period columns come first because they answer the question the page is
 * for; the overall pair sits to their right as the context for it. Ordered by
 * in-period revenue, unpriced projects last (see `buildFinanceReport`).
 *
 * Margin *amounts* are toned by `marginAmountTone` — the same helper the project
 * budget panel uses, so a loss is red in exactly the same circumstances on both
 * surfaces, rounded to whole dollars first so a figure reading "CA$0" is never red.
 */
export function FinanceProjectsTable({
  projects,
  inPeriodTotals,
  currency,
}: {
  projects: ProjectFinance[];
  /** The footer figures — the portfolio totals, so the column visibly sums. */
  inPeriodTotals: FinanceTotals;
  currency: DisplayCurrency;
}) {
  const { money } = aggregateMoneyFormatters(currency);

  return (
    <ReportSection
      title="Active projects"
      description="Projects with at least one live role overlapping the window. Revenue and margin in the period, and over the whole engagement."
      caption="A project spanning the window edge shows less in period than overall — that is the plan outside the window, not a shortfall. A fee's in-period share is shown beside it."
    >
      {projects.length === 0 ? (
        <EmptyState bordered>
          No projects were active in this period.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded border">
          <Table className={ROOMY_TABLE}>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Billing</TableHead>
                <TableHead className="text-right">Hours</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
                <TableHead className="text-right">Revenue overall</TableHead>
                <TableHead className="text-right">Margin overall</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map((row) => (
                <TableRow key={row.projectId}>
                  <TableCell>
                    <Link
                      href={`/projects/${row.projectId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {row.linesOfBusiness
                        .map((lob) => LINE_OF_BUSINESS_LABELS[lob])
                        .join(", ")}
                      {row.startDate && row.endDate
                        ? ` · ${formatDateRange(row.startDate, row.endDate)}`
                        : ""}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/companies/${row.companyId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {row.companyName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.billingType
                      ? BILLING_TYPE_LABELS[row.billingType]
                      : "No budget set"}
                    {row.feeShare == null ? null : (
                      <span className="block text-xs">
                        {formatPercent(row.feeShare)} of fee in period
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHours(row.inPeriod.totals.hours)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(row.inPeriod.totals.revenue)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums",
                      marginAmountTone(row.inPeriod.totals.margin),
                    )}
                  >
                    {money(row.inPeriod.totals.margin)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(row.inPeriod.totals.marginPercent)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {money(row.overall.totals.revenue)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right tabular-nums text-muted-foreground",
                      marginAmountTone(row.overall.totals.margin),
                    )}
                  >
                    {money(row.overall.totals.margin)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                {/* The footer totals the IN-PERIOD columns only. Summing the
                    overall pair here would double-count a project appearing in
                    two windows a reader looks at in turn, and "overall" is not a
                    quantity that belongs to this period. */}
                <TableCell colSpan={3}>In period total</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatHours(inPeriodTotals.hours)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {money(inPeriodTotals.revenue)}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right tabular-nums",
                    marginAmountTone(inPeriodTotals.margin),
                  )}
                >
                  {money(inPeriodTotals.margin)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPercent(inPeriodTotals.marginPercent)}
                </TableCell>
                <TableCell colSpan={2} />
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </ReportSection>
  );
}
