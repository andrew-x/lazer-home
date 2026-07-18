"use client";

import { IconClock, IconCoin, IconUsers } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { CompensationRecord } from "@/actions/staff/getCompensationSummaryData";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { ALL, FilterLabel, SegmentedFilter } from "@/components/form/filters";
import { CompensationScatter } from "@/components/performance/compensation-scatter";
import { StatCard } from "@/components/performance/stat-card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type Currency, formatMoney } from "@/lib/currency";
import { convert } from "@/lib/fx";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/line-of-business";
import { computeByRole, type StatRow } from "@/lib/performance-stats";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff-enums";

/** Only CAD and USD are offered as display currencies. */
const DISPLAY_CURRENCIES = [
  "CAD",
  "USD",
] as const satisfies readonly Currency[];

type FilterOptions = {
  lineOfBusiness: string[];
  role: string[];
  employmentType: string[];
};

export function PerformanceDashboard({
  records,
  rates,
  filterOptions,
}: {
  records: CompensationRecord[];
  rates: ExchangeRates;
  filterOptions: FilterOptions;
}) {
  const [lineOfBusiness, setLineOfBusiness] = useState(ALL);
  const [role, setRole] = useState(ALL);
  const [employmentType, setEmploymentType] = useState(ALL);
  const [currency, setCurrency] = useState<Currency>("CAD");
  const [chartMetric, setChartMetric] = useState<"comp" | "hourly">("comp");

  const { overall, byRole, rows } = useMemo(() => {
    const filtered = records.filter(
      (r) =>
        (lineOfBusiness === ALL || r.lineOfBusiness === lineOfBusiness) &&
        (role === ALL || r.role === role) &&
        (employmentType === ALL || r.employmentType === employmentType),
    );

    // Normalize every person's comp (base + guaranteed bonus) and hourly rate to
    // the selected display currency before aggregating. Rows are anonymous — the
    // server strips identity, so there is nothing here to key a point back to.
    const people: StatRow[] = filtered.map((r) => ({
      role: r.role,
      comp: convert(
        r.base + r.guaranteedBonus,
        r.currency,
        currency,
        rates.rates,
      ),
      hourly: convert(r.hourlyRate, r.currency, currency, rates.rates),
    }));

    return { ...computeByRole(people, filterOptions.role), rows: people };
  }, [
    records,
    rates,
    filterOptions.role,
    lineOfBusiness,
    role,
    employmentType,
    currency,
  ]);

  const money = (value: number | null) =>
    value == null
      ? "—"
      : formatMoney(value, currency, {
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        });

  const range = (min: number | null, max: number | null) =>
    min == null || max == null ? "—" : `${money(min)} – ${money(max)}`;

  const chartValues = rows.map((r) =>
    chartMetric === "comp" ? r.comp : r.hourly,
  );
  const chartCaption = `${
    chartMetric === "comp" ? "Total compensation" : "Hourly rate"
  } per staff member (n = ${overall.headcount}), sorted low → high`;

  return (
    <div className="flex flex-col gap-6">
      {/* Filters */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <SegmentedFilter
            label="Line of business"
            value={lineOfBusiness}
            options={filterOptions.lineOfBusiness}
            labels={LINE_OF_BUSINESS_LABELS}
            onChange={setLineOfBusiness}
          />
          <SegmentedFilter
            label="Employment type"
            value={employmentType}
            options={filterOptions.employmentType}
            labels={EMPLOYMENT_TYPE_LABELS}
            onChange={setEmploymentType}
          />
          <SegmentedFilter
            label="Role"
            value={role}
            options={filterOptions.role}
            labels={ROLE_LABELS}
            onChange={setRole}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <FilterLabel>Currency</FilterLabel>
          <ToggleGroup
            variant="outline"
            spacing={0}
            aria-label="Display currency"
            value={[currency]}
            onValueChange={(values) => {
              if (values.length > 0) setCurrency(values[0] as Currency);
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
              : `Amounts normalized to ${currency}. Rates as of ${rates.asOf}.`}
          </p>
        </div>
      </div>

      {/* Overall highlights */}
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Headcount"
          value={String(overall.headcount)}
          hint="Active staff (filtered)"
          icon={IconUsers}
        />
        <StatCard
          label="Avg compensation"
          value={money(overall.avgComp)}
          hint="Base + guaranteed bonus"
          icon={IconCoin}
        />
        <StatCard
          label="Avg hourly rate"
          value={money(overall.avgHourly)}
          hint="Per hour"
          icon={IconClock}
        />
      </div>

      {/* By-role breakdown */}
      {overall.headcount === 0 ? (
        <p className="text-sm text-muted-foreground">
          No staff match the selected filters.
        </p>
      ) : (
        <>
          <div className="rounded border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead className="text-right">Headcount</TableHead>
                  <TableHead className="text-right">Avg comp</TableHead>
                  <TableHead className="text-right">Comp range</TableHead>
                  <TableHead className="text-right">Avg hourly</TableHead>
                  <TableHead className="text-right">Hourly range</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byRole.map(({ role: r, stats }) => (
                  <TableRow key={r}>
                    <TableCell className="font-medium">
                      {ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {stats.headcount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(stats.avgComp)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {range(stats.minComp, stats.maxComp)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {money(stats.avgHourly)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {range(stats.minHourly, stats.maxHourly)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell>All roles</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {overall.headcount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(overall.avgComp)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {range(overall.minComp, overall.maxComp)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(overall.avgHourly)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {range(overall.minHourly, overall.maxHourly)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            </Table>
          </div>

          {/* Distribution scatter — one dot per staff member, sorted ascending */}
          <div className="flex flex-col gap-4 rounded border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-heading text-sm font-semibold">
                Distribution by staff member
              </h3>
              <ToggleGroup
                variant="outline"
                spacing={0}
                aria-label="Chart metric"
                value={[chartMetric]}
                onValueChange={(values) => {
                  if (values.length > 0) {
                    setChartMetric(values[0] as "comp" | "hourly");
                  }
                }}
              >
                <ToggleGroupItem value="comp">Compensation</ToggleGroupItem>
                <ToggleGroupItem value="hourly">Hourly rate</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <CompensationScatter
              values={chartValues}
              formatValue={money}
              caption={chartCaption}
            />
          </div>
        </>
      )}
    </div>
  );
}
