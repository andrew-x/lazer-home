"use client";

import { IconStar, IconUserQuestion } from "@tabler/icons-react";
import { useMemo } from "react";
import type { RatingRecord } from "@/actions/performance/getRatingsSummaryData";
import {
  DashboardFilterBar,
  type FilterOptions,
  matchesFilters,
  useDashboardFilters,
} from "@/components/performance/dashboard-filters";
import { LevelDistributionBarChart } from "@/components/performance/level-distribution-bar-chart";
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
import {
  computeAverageLevel,
  computeAverageLevelByRole,
  computeAverageSubratingsByRole,
  computeLevelDistribution,
  countUnrated,
} from "@/lib/performance/rating-stats";
import { ROLE_LABELS } from "@/lib/staff/staff-enums";
import { formatAverageLevel } from "@/lib/staff/staff-rating";

/**
 * The **Levels dashboard** (`/reporting/levels`): staff level (L0–L4)
 * analytics — distribution, average level overall and per role, and per-role
 * subrating averages. Gated by `ratings.view` (manager/admin) at the page, which
 * is stricter than the sibling Compensation dashboard's `staff.viewCompensation`
 * (finance sees comp but never levels).
 *
 * **No money on this page** — the comp-by-level breakdown lives on the
 * Compensation dashboard, so the filter bar renders no currency toggle (it gets no
 * `rates`) and nothing here needs the FX rates.
 */
export function LevelsDashboard({
  records,
  filterOptions,
}: {
  records: RatingRecord[];
  filterOptions: FilterOptions;
}) {
  const filters = useDashboardFilters();
  const { lineOfBusiness, role, employmentType } = filters;
  const roleOrder = filterOptions.role;

  const filtered = useMemo(
    () =>
      records.filter((r) =>
        matchesFilters(r.employment, { lineOfBusiness, role, employmentType }),
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

  // Average subrating per category, grouped by role (only roles with a rubric
  // and at least one scored category). Anonymized like the rest of the dashboard.
  const subratingsByRole = useMemo(
    () =>
      computeAverageSubratingsByRole(
        filtered.map((r) => ({
          role: r.employment?.role ?? "",
          subratings: r.subratings,
        })),
        roleOrder,
      ),
    [filtered, roleOrder],
  );

  const ratedCount = total - unrated;

  return (
    <div className="flex flex-col gap-6">
      {/* No `rates` → no currency toggle: nothing on this page shows money. */}
      <DashboardFilterBar filters={filters} options={filterOptions} />

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
            <h3 className="font-heading text-sm font-semibold">
              Level distribution
            </h3>
            <LevelDistributionBarChart
              data={distribution}
              caption={`Headcount per level (${ratedCount} rated, ${unrated} unrated)`}
            />
          </div>

          {/* Average level by role */}
          <div className="flex flex-col gap-2">
            <h3 className="font-heading text-sm font-semibold">
              Average level by role
            </h3>
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

          {/* Average subrating by category, per role (only when scored) */}
          {subratingsByRole.length > 0 ? (
            <div className="flex flex-col gap-4">
              <h3 className="font-heading text-sm font-semibold">
                Subratings by category
              </h3>
              {subratingsByRole.map(({ role: r, categories }) => (
                <div key={r} className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium text-muted-foreground">
                    {ROLE_LABELS[r as keyof typeof ROLE_LABELS] ?? r}
                  </h4>
                  <div className="rounded border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Category</TableHead>
                          <TableHead className="text-right">
                            Avg subrating
                          </TableHead>
                          <TableHead className="text-right">Rated</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {categories.map((category) => (
                          <TableRow key={category.key}>
                            <TableCell className="font-medium">
                              {category.label}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatAverageLevel(category.average)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {category.ratedCount}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
