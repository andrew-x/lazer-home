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
} from "@/lib/utilization/utilization-report";

/**
 * **Bench** — unstaffed time for full-time billable staff, as both a total and a
 * streak (a person idle for one day a week all month is a very different problem
 * from one idle for a fortnight straight), plus how quickly new joiners land on
 * their first project.
 */
export function BenchCard({ bench }: { bench: BenchSummary }) {
  return (
    <ReportSection
      title="Bench"
      description="Unstaffed working days for full-time billable staff."
      caption={`A bench day is an employed working day with no role and no approved leave. Streaks run over working days: a weekend doesn't break one, a day of leave does. Days to first placement measures each joiner's start date to their earliest confirmed role, which may fall outside this period.`}
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
          label="Logged bench"
          value={formatHours(bench.confirmedBenchHours)}
          hint={
            bench.confirmedBenchHours == null
              ? "Requires timesheet access"
              : "Confirmed unallocated hours"
          }
          icon={IconBeach}
        />
      </div>
    </ReportSection>
  );
}
