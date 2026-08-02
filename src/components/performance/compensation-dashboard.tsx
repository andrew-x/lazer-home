"use client";

import { IconClock, IconCoin, IconUsers } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import type { RatingRecord } from "@/actions/performance/getRatingsSummaryData";
import type { CompensationRecord } from "@/actions/staff/getCompensationSummaryData";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { CompensationScatter } from "@/components/performance/compensation-scatter";
import {
  DashboardFilterBar,
  type FilterOptions,
  matchesFilters,
  useDashboardFilters,
} from "@/components/performance/dashboard-filters";
import { StatCard } from "@/components/stat-card";
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
import { aggregateMoneyFormatters } from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";
import {
  computeByRole,
  type StatRow,
} from "@/lib/performance/performance-stats";
import { ROLE_LABELS } from "@/lib/staff/staff-enums";
import { formatLevel, RATING_LEVELS } from "@/lib/staff/staff-rating";

/** The by-level breakdown reads in ascending level order (L0 → L4). */
const LEVEL_ORDER = RATING_LEVELS.map((level) => formatLevel(level));

/**
 * The **Compensation dashboard** (`/dashboards/compensation`): workforce headcount
 * + compensation, overall and broken down **by role** and **by staff level**, over
 * anonymized latest-employment rows. Gated by `staff.viewCompensation` at the page.
 *
 * Two sibling dashboards own the neighbouring cuts of the same workforce, and the
 * split is deliberate — each answers one question rather than this page answering
 * three: level *analytics* (distribution, average level, subratings) live at
 * `/dashboards/levels` (`levels-dashboard.tsx`), and one-off **bonus payments** at
 * `/dashboards/bonuses` (`bonus-dashboard.tsx`). Bonuses in particular don't
 * reconcile per-head with anything here — they include people who have since left
 * — which is why they no longer sit under these tables.
 */
export function CompensationDashboard({
  records,
  ratingRecords,
  rates,
  filterOptions,
}: {
  records: CompensationRecord[];
  /**
   * Per-active-staff level + comp rows backing the by-level breakdown. Provided
   * only to `ratings.view` holders (managers/admins), since levels are stricter
   * than comp; when omitted that one table is hidden (finance sees the rest).
   */
  ratingRecords?: RatingRecord[];
  rates: ExchangeRates;
  filterOptions: FilterOptions;
}) {
  const filters = useDashboardFilters();
  const { lineOfBusiness, role, employmentType, currency } = filters;
  const [chartMetric, setChartMetric] = useState<"comp" | "hourly">("comp");

  const { overall, byRole, rows } = useMemo(() => {
    const filtered = records.filter((r) =>
      matchesFilters(r, { lineOfBusiness, role, employmentType }),
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

  // Comp/rate per staff level, over the same filters + display currency. Only
  // RATED staff WITH an employment row contribute, so this breakdown's own
  // "All levels" footer can total less than the headcount above it.
  const byLevel = useMemo(() => {
    if (!ratingRecords) return null;

    const ratedRows: StatRow[] = ratingRecords.flatMap((r) => {
      if (
        !matchesFilters(r.employment, { lineOfBusiness, role, employmentType })
      )
        return [];
      if (r.level == null || r.employment == null) return [];
      const {
        base,
        guaranteedBonus,
        hourlyRate,
        currency: from,
      } = r.employment;
      return [
        {
          role: formatLevel(r.level),
          comp: convert(base + guaranteedBonus, from, currency, rates.rates),
          hourly: convert(hourlyRate, from, currency, rates.rates),
        },
      ];
    });
    return computeByRole(ratedRows, LEVEL_ORDER);
  }, [ratingRecords, rates, lineOfBusiness, role, employmentType, currency]);

  const { money, range } = aggregateMoneyFormatters(currency);

  const chartValues = rows.map((r) =>
    chartMetric === "comp" ? r.comp : r.hourly,
  );
  const chartCaption = `${
    chartMetric === "comp" ? "Total compensation" : "Hourly rate"
  } per staff member (n = ${overall.headcount}), sorted low → high`;

  return (
    <div className="flex flex-col gap-6">
      <DashboardFilterBar
        filters={filters}
        options={filterOptions}
        rates={rates}
      />

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

          {/* By-level breakdown — only for viewers who may also see levels.
              Unheaded, like the by-role table above it: the "Level" column
              header already says what the rows are. */}
          {byLevel ? (
            <div className="flex flex-col gap-2">
              {byLevel.overall.headcount === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No rated staff match the selected filters.
                </p>
              ) : (
                <div className="rounded border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Level</TableHead>
                        <TableHead className="text-right">Headcount</TableHead>
                        <TableHead className="text-right">Avg comp</TableHead>
                        <TableHead className="text-right">Comp range</TableHead>
                        <TableHead className="text-right">Avg hourly</TableHead>
                        <TableHead className="text-right">
                          Hourly range
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byLevel.byRole.map(({ role: level, stats }) => (
                        <TableRow key={level}>
                          <TableCell className="font-medium">{level}</TableCell>
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
                        <TableCell>All levels</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {byLevel.overall.headcount}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(byLevel.overall.avgComp)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {range(
                            byLevel.overall.minComp,
                            byLevel.overall.maxComp,
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {money(byLevel.overall.avgHourly)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {range(
                            byLevel.overall.minHourly,
                            byLevel.overall.maxHourly,
                          )}
                        </TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </div>
              )}
            </div>
          ) : null}

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
