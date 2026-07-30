"use client";

import { type ReactNode, useState } from "react";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { toEnumValue } from "@/components/form/enum-select";
import { ALL, FilterLabel, SegmentedFilter } from "@/components/form/filters";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { type Currency, DISPLAY_CURRENCIES } from "@/lib/format/currency";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";

/**
 * The enum option lists backing the three dimension filters, sourced from the DB
 * enums by `performanceFilterOptions` (see `getCompensationSummaryData`).
 */
export type FilterOptions = {
  lineOfBusiness: string[];
  role: string[];
  employmentType: string[];
};

/** The filter + currency state produced by {@link useDashboardFilters}. */
export type DashboardFilters = ReturnType<typeof useDashboardFilters>;

/**
 * Filter + display-currency state for a performance dashboard. The compensation
 * and levels dashboards are separate pages, so each owns its own instance — this
 * hook exists so the two read from an identical control bar rather than drifting.
 */
export function useDashboardFilters() {
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [employmentType, setEmploymentType] = useState(ALL);
  const [currency, setCurrency] = useState<Currency>("CAD");

  return {
    lineOfBusiness,
    setLineOfBusiness,
    role,
    setRole,
    employmentType,
    setEmploymentType,
    currency,
    setCurrency,
  };
}

/** The dimensions of one anonymized record, as the filters see them. */
type Dimensions = {
  lineOfBusiness: string;
  role: string;
  employmentType: string;
};

/** The filter values only — the shape callers pass to {@link matchesFilters}. */
type FilterValues = Pick<
  DashboardFilters,
  "lineOfBusiness" | "role" | "employmentType"
>;

/**
 * Does a record's dimensions survive the current filters? `null` dimensions (the
 * rare active staffer with no employment row) pass only while every filter is
 * "All" — they have no dimension to match against, so any narrowing excludes them.
 */
export function matchesFilters(
  dimensions: Dimensions | null,
  filters: FilterValues,
): boolean {
  if (dimensions == null) {
    return (
      filters.lineOfBusiness === ALL &&
      filters.role === ALL &&
      filters.employmentType === ALL
    );
  }
  return (
    (filters.lineOfBusiness === ALL ||
      dimensions.lineOfBusiness === filters.lineOfBusiness) &&
    (filters.role === ALL || dimensions.role === filters.role) &&
    (filters.employmentType === ALL ||
      dimensions.employmentType === filters.employmentType)
  );
}

/**
 * The control bar both performance dashboards render at the top: three segmented
 * dimension filters, plus the CAD/USD display-currency toggle. Filtering is
 * in-memory over the once-fetched anonymized rows — see the dashboards.
 *
 * `rates` drives the currency toggle, so **omit it on a dashboard with no money
 * on screen** (the levels dashboard) — the toggle would change nothing there, and
 * tying it to the rates makes it impossible to offer a currency choice without the
 * rates that would honour it.
 *
 * `extraFilters` is the slot for a dimension only ONE dashboard has (the bonus
 * dashboard's bonus type). Such a filter must stay out of `useDashboardFilters` and
 * `matchesFilters` — those are shared with dashboards where the dimension doesn't
 * exist — so the owning dashboard holds its state and passes the control in here to
 * sit alongside the shared ones.
 */
export function DashboardFilterBar({
  filters,
  options,
  rates,
  extraFilters,
}: {
  filters: DashboardFilters;
  options: FilterOptions;
  rates?: ExchangeRates;
  extraFilters?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <SegmentedFilter
          label="Line of business"
          value={filters.lineOfBusiness}
          options={options.lineOfBusiness}
          labels={LINE_OF_BUSINESS_LABELS}
          onChange={filters.setLineOfBusiness}
        />
        <SegmentedFilter
          label="Employment type"
          value={filters.employmentType}
          options={options.employmentType}
          labels={EMPLOYMENT_TYPE_LABELS}
          onChange={filters.setEmploymentType}
        />
        <SegmentedFilter
          label="Role"
          value={filters.role}
          options={options.role}
          labels={ROLE_LABELS}
          onChange={filters.setRole}
        />
        {extraFilters}
      </div>

      {rates ? (
        <div className="flex flex-col gap-1.5">
          <FilterLabel>Currency</FilterLabel>
          <ToggleGroup
            variant="outline"
            spacing={0}
            aria-label="Display currency"
            value={[filters.currency]}
            onValueChange={(values) => {
              const next = toEnumValue(DISPLAY_CURRENCIES, values[0] ?? null);
              if (next) filters.setCurrency(next);
            }}
          >
            {DISPLAY_CURRENCIES.map((code) => (
              <ToggleGroupItem key={code} value={code}>
                {code}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">
            {rates.stale
              ? "Exchange rates unavailable — showing approximate fallback rates."
              : `Amounts normalized to ${filters.currency}. Rates as of ${rates.asOf}.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}
