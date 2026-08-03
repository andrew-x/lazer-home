import {
  IconPlaneDeparture,
  IconSum,
  IconUserCheck,
  IconUserOff,
  IconZzz,
} from "@tabler/icons-react";
import { StatCard } from "@/components/stat-card";
import { ReportSection } from "@/components/utilization/report-primitives";
import {
  formatCount,
  formatDays,
  formatHours,
} from "@/lib/utilization/utilization-format";
import {
  hoursFor,
  type PtoSummary,
  type ReportBasis,
} from "@/lib/utilization/utilization-report";

/**
 * **PTO** — approved leave landing in the period, its shape, and how evenly it is
 * taken, for **full-time staff only**: planned leave books against a fixed working
 * week, and an hourly person has none to book it against.
 *
 * Deliberately carries no breakdown by leave *type*: the reason someone is away is
 * gated on `pto.review`, and this report never reads it.
 */
export function PtoCard({
  pto,
  basis,
}: {
  pto: PtoSummary;
  basis: ReportBasis;
}) {
  const logged = basis === "logged";

  return (
    <ReportSection
      title="PTO"
      description="Approved leave taken by full-time staff during the period."
      caption="Total days are clipped to the period and count working days only; average and longest measure the whole leave record, so a holiday straddling the period edge keeps its true length — both come from approved leave on either basis. Logged PTO hours come from the timesheet category, which is recorded independently of approved leave, so the two can legitimately disagree."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total PTO"
          value={formatDays(pto.totalDays)}
          hint="Working days in this period"
          icon={IconSum}
        />
        <StatCard
          label="Longest record"
          value={formatDays(pto.maxRecordLength)}
          hint={`Average ${formatDays(pto.averageRecordLength)}`}
          icon={IconPlaneDeparture}
        />
        <StatCard
          label="Took leave"
          value={formatCount(pto.peopleWithPto)}
          hint="People with approved leave"
          icon={IconUserCheck}
        />
        <StatCard
          label="Took none"
          value={formatCount(pto.peopleWithoutPto)}
          hint="People with no leave this period"
          icon={IconUserOff}
        />
        <StatCard
          label="PTO hours"
          value={formatHours(hoursFor(pto.ptoHours, basis))}
          hint={
            logged ? "Logged PTO-category time" : "Approved leave as capacity"
          }
          icon={IconZzz}
        />
      </div>
    </ReportSection>
  );
}
