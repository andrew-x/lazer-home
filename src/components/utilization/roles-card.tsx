import {
  IconBriefcase,
  IconCalendarTime,
  IconLayersSubtract,
  IconPlayerPlay,
  IconPlayerStop,
  IconStack2,
} from "@tabler/icons-react";
import { StatCard } from "@/components/stat-card";
import { ReportSection } from "@/components/utilization/report-primitives";
import {
  formatCount,
  formatRatio,
  formatWeeks,
} from "@/lib/utilization/utilization-format";
import type {
  ReportBasis,
  RoleSummary,
} from "@/lib/utilization/utilization-report";

/**
 * **Roles** — the staffing lines active in the period: how many, how much churn,
 * how long they run, and how thickly they stack on a project.
 *
 * Only the project count has two sides to it. Every other tile describes the plan
 * itself — a role's span and its stacking are properties of how we staffed, and a
 * timesheet has nothing to say about them — so they read the same on either basis.
 */
export function RolesCard({
  roles,
  basis,
}: {
  roles: RoleSummary;
  basis: ReportBasis;
}) {
  const logged = basis === "logged";

  return (
    <ReportSection
      title="Roles"
      description="Staffing lines overlapping the period, and the projects behind them."
      caption="A role counts as active if any part of its span falls inside the period; started and ended count only spans that begin or finish within it. Average length measures the whole role, not the part inside the period. Tentative roles are excluded: a forecast isn't a staffing line."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Active roles"
          value={formatCount(roles.activeRoles)}
          hint="Overlapping this period"
          icon={IconStack2}
        />
        <StatCard
          label="Started"
          value={formatCount(roles.started)}
          hint="Began in this period"
          icon={IconPlayerPlay}
        />
        <StatCard
          label="Ended"
          value={formatCount(roles.ended)}
          hint="Finished in this period"
          icon={IconPlayerStop}
        />
        <StatCard
          label="Average length"
          value={formatWeeks(roles.averageLengthWeeks)}
          hint="Full span, in working weeks"
          icon={IconCalendarTime}
        />
        <StatCard
          label="Roles per project"
          value={formatRatio(roles.averageRolesPerProject)}
          hint="Average staffing lines each"
          icon={IconLayersSubtract}
        />
        <StatCard
          label="Projects"
          value={formatCount(
            logged ? roles.projectsWithLoggedTime : roles.uniqueProjects,
          )}
          hint={logged ? "With logged time" : "Staffed in this period"}
          icon={IconBriefcase}
        />
      </div>
    </ReportSection>
  );
}
