import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportSection } from "@/components/utilization/report-primitives";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";
import {
  formatHours,
  formatHoursDelta,
  formatPercent,
} from "@/lib/utilization/utilization-format";
import type { StaffBreakdownRow } from "@/lib/utilization/utilization-report";

/**
 * **Staff breakdown** — one row per person: their capacity for the period, both
 * hour series against it, and how much of their time is actually backed by a
 * submitted timesheet.
 *
 * The confirmed columns are per-person gated. A viewer without `timesheets.edit`
 * sees their own row filled in and everyone else's marked as restricted — never
 * as zero, which would read as "logged nothing".
 */
export function StaffBreakdownCard({ rows }: { rows: StaffBreakdownRow[] }) {
  return (
    <ReportSection
      title="Staff breakdown"
      description="Capacity, planned time and logged time for each person."
      caption="Available hours are adjusted for join and termination dates, so someone who started mid-period has a smaller denominator. Hourly staff show no capacity or utilization — they have no fixed working week to measure against."
    >
      {rows.length === 0 ? (
        <EmptyState bordered>
          No billable staff match the current line-of-business filter.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Discipline</TableHead>
                <TableHead>Line of business</TableHead>
                <TableHead className="text-right">Available</TableHead>
                <TableHead className="text-right">Planned</TableHead>
                <TableHead className="text-right">Confirmed</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">Planned %</TableHead>
                <TableHead className="text-right">Confirmed %</TableHead>
                <TableHead className="text-right">Weeks</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.staffId}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.role ? ROLE_LABELS[row.role] : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.lineOfBusiness
                      ? LINE_OF_BUSINESS_LABELS[row.lineOfBusiness]
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.availableHours == null ? (
                      <span
                        className="text-muted-foreground"
                        title={`${row.employmentType ? EMPLOYMENT_TYPE_LABELS[row.employmentType] : "Non full-time"} — no fixed capacity`}
                      >
                        n/a
                      </span>
                    ) : (
                      formatHours(row.availableHours)
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHours(row.plannedProjectHours)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.hasConfirmedAccess ? (
                      formatHours(row.confirmedProjectHours)
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title="Requires timesheet access"
                      >
                        restricted
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHoursDelta(row.varianceHours)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(row.plannedUtilization)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(row.confirmedUtilization)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {row.hasConfirmedAccess
                      ? `${row.weeksSubmitted}/${row.weeksInRange}`
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </ReportSection>
  );
}
