import { IconChartPie, IconClockHour4, IconGauge } from "@tabler/icons-react";
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
import { ReportSection } from "@/components/utilization/report-primitives";
import {
  formatHours,
  formatHoursDelta,
  formatPercent,
} from "@/lib/utilization/utilization-format";
import type {
  UtilizationSplitRow,
  UtilizationSummary,
} from "@/lib/utilization/utilization-report";

const ROW_LABELS: Record<UtilizationSplitRow["key"], string> = {
  project: "Project",
  pto: "PTO",
  bench: "Bench",
  internalAdmin: "Internal admin",
};

/**
 * **Utilization** — the headline. Available hours for full-time staff, project
 * hours across everyone, and the split of full-time time into project / PTO /
 * bench, in both series against the same denominator.
 *
 * Project hours can exceed available hours: two overlapping full-time roles read
 * as 200%, and that is shown rather than clamped — the allocations planner never
 * sums a person's load across projects, so this is the only place over-allocation
 * surfaces. Internal admin has no planned counterpart; the plan has no bucket for
 * it, so its planned cell is empty rather than zero.
 */
export function UtilizationCard({
  utilization,
  includeTentative,
}: {
  utilization: UtilizationSummary;
  includeTentative: boolean;
}) {
  const { availableHours, projectHours, rows } = utilization;

  return (
    <ReportSection
      title="Utilization"
      description="Available capacity against the time planned and the time logged."
      caption={`Available hours count full-time staff only, at 8 hours per employed working day — hourly staff have no fixed capacity, so they carry no denominator, though their project hours are included in the total. Approved leave takes precedence over a role on the same day, so the three planned rows add up to available hours unless someone is over-allocated.${includeTentative ? " Tentative roles are included at full weight." : ""}`}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Available hours"
          value={formatHours(availableHours)}
          hint="Full time, adjusted for join and leave dates"
          icon={IconClockHour4}
        />
        <StatCard
          label="Project hours"
          value={formatHours(projectHours.planned)}
          hint={`Planned · confirmed ${formatHours(projectHours.confirmed)}`}
          icon={IconChartPie}
        />
        <StatCard
          label="Utilization"
          value={formatPercent(utilization.utilization.planned)}
          hint={`Planned · confirmed ${formatPercent(utilization.utilization.confirmed)}`}
          icon={IconGauge}
        />
      </div>

      <div className="overflow-x-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Full-time time</TableHead>
              <TableHead className="text-right">Planned</TableHead>
              <TableHead className="text-right">% available</TableHead>
              <TableHead className="text-right">Confirmed</TableHead>
              <TableHead className="text-right">% available</TableHead>
              <TableHead className="text-right">Variance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="font-medium">
                  {ROW_LABELS[row.key]}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.planned == null ? "—" : formatHours(row.planned)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPercent(row.plannedShare)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatHours(row.confirmed)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatPercent(row.confirmedShare)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.planned == null || row.confirmed == null
                    ? "—"
                    : formatHoursDelta(row.confirmed - row.planned)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">Available</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatHours(availableHours)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {availableHours === 0 ? "—" : "100.0%"}
              </TableCell>
              <TableCell className="text-right tabular-nums">—</TableCell>
              <TableCell className="text-right tabular-nums">—</TableCell>
              <TableCell className="text-right tabular-nums">—</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </ReportSection>
  );
}
