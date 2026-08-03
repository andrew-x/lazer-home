import {
  IconBeach,
  IconClockPause,
  IconHourglassHigh,
  IconUserExclamation,
  IconUserQuestion,
  IconWaveSine,
} from "@tabler/icons-react";
import { StatCard } from "@/components/stat-card";
import { ReportSection } from "@/components/utilization/report-primitives";
import {
  formatCount,
  formatDays,
  formatHours,
} from "@/lib/utilization/utilization-format";
import {
  BENCH_STREAK_THRESHOLD,
  type BenchSummary,
  hoursFor,
  type ReportBasis,
} from "@/lib/utilization/utilization-report";

/**
 * **Bench** — unstaffed time for full-time billable staff, as both a total and a
 * streak (a person idle for one day a week all month is a very different problem
 * from one idle for a fortnight straight), plus how quickly new joiners land on
 * their first project.
 *
 * Only the hours tile follows the basis. Streaks and bench *days* are derived from
 * the shape of the plan — a timesheet records that someone logged bench time, not
 * which consecutive days went unstaffed — so they read the same either way.
 */
export function BenchCard({
  bench,
  basis,
}: {
  bench: BenchSummary;
  basis: ReportBasis;
}) {
  const logged = basis === "logged";

  return (
    <ReportSection
      title="Bench"
      description="Unstaffed working days for full-time billable staff."
      caption="A bench day is an employed working day with no role and no approved leave. Streaks run over working days: a weekend doesn't break one, a day of leave does. Days to first placement measures each joiner's start date to their earliest confirmed role, which may fall outside this period. The streak and day counts come from the plan on either basis."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={`Over ${BENCH_STREAK_THRESHOLD} days`}
          value={formatCount(bench.staffOverThreshold)}
          hint={`Staff with a streak longer than ${BENCH_STREAK_THRESHOLD} days`}
          icon={IconUserExclamation}
        />
        <StatCard
          label="Longest streak"
          value={formatDays(bench.maxStreak)}
          hint={`Average streak ${formatDays(bench.averageStreak)}`}
          icon={IconWaveSine}
        />
        <StatCard
          label="Most bench days"
          value={formatDays(bench.maxBenchDays)}
          hint={`Average ${formatDays(bench.averageBenchDays)} per person`}
          icon={IconClockPause}
        />
        <StatCard
          label="Days to placement"
          value={formatDays(bench.averageDaysToFirstPlacement)}
          hint="Average for joiners in this period"
          icon={IconHourglassHigh}
        />
        <StatCard
          label="Unplaced joiners"
          value={formatCount(bench.unplacedJoiners)}
          hint="Joined with no confirmed role yet"
          icon={IconUserQuestion}
        />
        <StatCard
          label="Bench hours"
          value={formatHours(hoursFor(bench.benchHours, basis))}
          hint={
            logged
              ? "Logged unallocated-bench time"
              : "Unstaffed full-time capacity"
          }
          icon={IconBeach}
        />
      </div>
    </ReportSection>
  );
}
