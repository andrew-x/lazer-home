import {
  IconBeach,
  IconChartPie,
  IconClockHour4,
  IconGauge,
  IconPlaneDeparture,
  IconUserDollar,
} from "@tabler/icons-react";
import { StatCard } from "@/components/stat-card";
import {
  DeviationFlag,
  DeviationNotice,
  ReportSection,
} from "@/components/utilization/report-primitives";
import {
  formatHours,
  formatPercent,
  formatPercentDelta,
} from "@/lib/utilization/utilization-format";
import {
  type HoursMetric,
  hoursDeviation,
  hoursFor,
  pickBasis,
  type ReportBasis,
  shareFor,
  type UtilizationSummary,
} from "@/lib/utilization/utilization-report";

/**
 * **Utilization** — the headline, as tiles rather than a table. Available capacity
 * for full-time staff, how it splits into project / PTO / bench, and the part-time
 * contribution alongside.
 *
 * There is no total: project + PTO + bench reconciles to available hours by
 * construction, so restating it would only add a row that agrees with itself.
 *
 * The split is full-time on **both** sides of the comparison: the plan books
 * capacity a full-timer has and an hourly person doesn't, so mixing hourly
 * people's logged PTO or bench into a full-time denominator would compare two
 * different populations. Hourly project hours get their own tile and their share
 * of the total instead.
 *
 * Project hours can exceed available hours: two overlapping full-time roles read
 * as 200%, and that is shown rather than clamped — the allocations planner never
 * sums a person's load across projects, so this is the only place over-allocation
 * surfaces. Internal admin has no planned counterpart and belongs to no practice,
 * so it is excluded rather than given a tile that only ever half-fills.
 */
export function UtilizationCard({
  utilization,
  basis,
}: {
  utilization: UtilizationSummary;
  basis: ReportBasis;
}) {
  const { availableHours, fullTimeProject, projectHoursHourly } = utilization;

  /** "62.5% of available" — plus the gap from plan, on the logged basis. */
  const shareHint = (value: HoursMetric) => {
    const share = `${formatPercent(shareFor(value, basis))} of available`;
    if (basis !== "logged") return share;
    return `${share} · ${formatPercentDelta(hoursDeviation(value.hours))} vs plan`;
  };

  return (
    <ReportSection
      title="Utilization"
      description="Available capacity for full-time staff, and what it went to."
      caption="Available hours count full-time staff only, at 8 hours per employed working day — hourly staff have no fixed working week to measure against, so they carry no denominator and no utilization %. Approved leave takes precedence over a role on the same day, so project, PTO and bench add up to available hours unless someone is over-allocated."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label="Available hours"
          value={formatHours(availableHours)}
          hint="Full time, adjusted for join and leave dates"
          icon={IconClockHour4}
        />
        <StatCard
          label="Utilization"
          value={formatPercent(shareFor(fullTimeProject, basis))}
          hint="Full-time project hours ÷ available"
          icon={IconGauge}
        />
        <StatCard
          label="Part-time project hours"
          value={formatHours(hoursFor(projectHoursHourly, basis))}
          hint={`${formatPercent(
            pickBasis(
              basis,
              utilization.hourlyProjectShare.planned,
              utilization.hourlyProjectShare.confirmed,
            ),
          )} of all project hours`}
          icon={IconUserDollar}
        />
        <StatCard
          label="Full-time project hours"
          value={formatHours(hoursFor(fullTimeProject.hours, basis))}
          hint={shareHint(fullTimeProject)}
          marker={
            <DeviationFlag series={fullTimeProject.hours} basis={basis} />
          }
          icon={IconChartPie}
        />
        <StatCard
          label="PTO hours"
          value={formatHours(hoursFor(utilization.pto.hours, basis))}
          hint={shareHint(utilization.pto)}
          marker={
            <DeviationFlag series={utilization.pto.hours} basis={basis} />
          }
          icon={IconPlaneDeparture}
        />
        <StatCard
          label="Bench hours"
          value={formatHours(hoursFor(utilization.bench.hours, basis))}
          hint={shareHint(utilization.bench)}
          marker={
            <DeviationFlag series={utilization.bench.hours} basis={basis} />
          }
          icon={IconBeach}
        />
      </div>

      <DeviationNotice
        series={fullTimeProject.hours}
        basis={basis}
        label="Full-time project hours"
      />
    </ReportSection>
  );
}
