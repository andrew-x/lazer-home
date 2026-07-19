"use client";

import { IconStar, IconUserQuestion } from "@tabler/icons-react";
import { useMemo } from "react";
import type { RatingRecord } from "@/actions/performance/getRatingsSummaryData";
import type { ExchangeRates } from "@/actions/staff/getExchangeRates";
import { ALL } from "@/components/form/filters";
import { LevelDistributionBarChart } from "@/components/performance/level-distribution-bar-chart";
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
import { type Currency, formatMoney } from "@/lib/currency";
import { convert } from "@/lib/fx";
import { computeByRole, type StatRow } from "@/lib/performance-stats";
import {
  computeAverageLevel,
  computeAverageLevelByRole,
  computeLevelDistribution,
  countUnrated,
} from "@/lib/rating-stats";
import { ROLE_LABELS } from "@/lib/staff-enums";
import {
  formatAverageLevel,
  formatLevel,
  RATING_LEVELS,
} from "@/lib/staff-rating";

/** The by-level breakdown reads in ascending level order (L0 → L4). */
const LEVEL_ORDER = RATING_LEVELS.map((level) => formatLevel(level));

/**
 * The staff-levels (L0–L4) section of the performance dashboard. Presentational:
 * it shares the parent dashboard's filter + currency state (passed as props) so
 * levels and compensation read from one control bar — no tabs. Rendered only for
 * `ratings.view` holders (managers/admins); the parent gates on that.
 */
export function LevelsSection({
  records,
  rates,
  roleOrder,
  lineOfBusiness,
  role,
  employmentType,
  currency,
}: {
  records: RatingRecord[];
  rates: ExchangeRates;
  roleOrder: string[];
  lineOfBusiness: string;
  role: string;
  employmentType: string;
  currency: Currency;
}) {
  const filtered = useMemo(
    () =>
      records.filter(
        (r) =>
          (lineOfBusiness === ALL ||
            r.employment?.lineOfBusiness === lineOfBusiness) &&
          (role === ALL || r.employment?.role === role) &&
          (employmentType === ALL ||
            r.employment?.employmentType === employmentType),
      ),
    [records, lineOfBusiness, role, employmentType],
  );

  // Level stats depend only on the filters (not the display currency).
  const { distribution, unrated, avgLevel, avgByRole, total } = useMemo(() => {
    const levels = filtered.map((r) => r.level);
    return {
      distribution: computeLevelDistribution(levels),
      unrated: countUnrated(levels),
      avgLevel: computeAverageLevel(levels),
      avgByRole: computeAverageLevelByRole(
        filtered.map((r) => ({
          role: r.employment?.role ?? "",
          level: r.level,
        })),
        roleOrder,
      ),
      total: filtered.length,
    };
  }, [filtered, roleOrder]);

  // Comp/rate per level: only RATED staff WITH an employment row contribute comp,
  // so the level rows sum to the "All levels" footer. Currency-dependent.
  const { overall, byRole: byLevel } = useMemo(() => {
    const ratedRows: StatRow[] = filtered.flatMap((r) => {
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
  }, [filtered, currency, rates]);

  const money = (value: number | null) =>
    value == null
      ? "—"
      : formatMoney(value, currency, {
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        });

  const range = (min: number | null, max: number | null) =>
    min == null || max == null ? "—" : `${money(min)} – ${money(max)}`;

  const ratedCount = total - unrated;

  return (
    <section className="flex flex-col gap-6 border-t pt-6">
      <div>
        <h3 className="font-heading text-lg font-semibold">Levels</h3>
        <p className="text-sm text-muted-foreground">
          Overall staff levels (L0–L4). Visible to managers and admins only.
        </p>
      </div>

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          No staff match the selected filters.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard
              label="Average level"
              value={formatAverageLevel(avgLevel)}
              hint={`Across ${ratedCount} rated staff`}
              icon={IconStar}
            />
            <StatCard
              label="Unrated"
              value={String(unrated)}
              hint="Active staff with no level"
              icon={IconUserQuestion}
            />
          </div>

          {/* Distribution bar chart */}
          <div className="flex flex-col gap-4 rounded border p-4">
            <h4 className="font-heading text-sm font-semibold">
              Level distribution
            </h4>
            <LevelDistributionBarChart
              data={distribution}
              caption={`Headcount per level (${ratedCount} rated, ${unrated} unrated)`}
            />
          </div>

          {/* By-level breakdown */}
          <div className="flex flex-col gap-2">
            <h4 className="font-heading text-sm font-semibold">
              Compensation by level
            </h4>
            {overall.headcount === 0 ? (
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
                      <TableHead className="text-right">Avg rate</TableHead>
                      <TableHead className="text-right">Rate range</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {byLevel.map(({ role: level, stats }) => (
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
            )}
          </div>

          {/* Average level by role */}
          <div className="flex flex-col gap-2">
            <h4 className="font-heading text-sm font-semibold">
              Average level by role
            </h4>
            <div className="rounded border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Avg level</TableHead>
                    <TableHead className="text-right">Rated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {avgByRole.map(({ role: r, averageLevel, ratedCount: n }) => (
                    <TableRow key={r}>
                      <TableCell className="font-medium">
                        {ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatAverageLevel(averageLevel)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {n}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>All roles</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatAverageLevel(avgLevel)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ratedCount}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
