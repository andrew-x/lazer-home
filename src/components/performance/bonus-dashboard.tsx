"use client";

import Link from "next/link";
import type { BonusSummaryData } from "@/actions/performance/getBonusSummaryData";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { BonusBreakdown } from "@/components/performance/bonus-breakdown";
import {
  DashboardFilterBar,
  type FilterOptions,
  useDashboardFilters,
} from "@/components/performance/dashboard-filters";
import { Button } from "@/components/ui/button";

/**
 * The **Bonuses dashboard** (`/dashboards/bonuses`): what we paid out in one
 * calendar year, broken down by line of business, role and bonus type. Gated by
 * `staff.viewCompensation` (`BONUS_PAYMENT_READ_ACCESS`) at the page.
 *
 * A thin shell: it owns the filter + display-currency state — shared with the
 * sibling Compensation dashboard via `useDashboardFilters`, so the two read from an
 * identical control bar — and hands it to {@link BonusBreakdown}, which owns every
 * number on the page. The *year* is a server concern (each year is a separate read)
 * and so arrives as a prop from the `year` search param.
 */
export function BonusDashboard({
  bonuses,
  year,
  rates,
  filterOptions,
  canEditBonuses,
}: {
  bonuses: BonusSummaryData;
  /** The selected calendar year, from the `year` search param. */
  year: number;
  rates: ExchangeRates;
  filterOptions: FilterOptions;
  /** True when this viewer may also record payments (`staff.edit` + comp). */
  canEditBonuses: boolean;
}) {
  const filters = useDashboardFilters();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <DashboardFilterBar
          filters={filters}
          options={filterOptions}
          rates={rates}
        />
        {canEditBonuses ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/people/bonus-payments" />}
          >
            Manage payments
          </Button>
        ) : null}
      </div>

      <BonusBreakdown
        records={bonuses.records}
        years={bonuses.years}
        year={year}
        unattributed={bonuses.unattributed}
        rates={rates}
        filters={filters}
        filterOptions={filterOptions}
      />
    </div>
  );
}
