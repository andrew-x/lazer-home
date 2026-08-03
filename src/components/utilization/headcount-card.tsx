import { IconArrowRight, IconUserPlus, IconUsers } from "@tabler/icons-react";
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
import { ReportSection } from "@/components/utilization/report-primitives";
import { ROLE_LABELS } from "@/lib/staff/staff-enums";
import { formatCount } from "@/lib/utilization/utilization-format";
import type { HeadcountSummary } from "@/lib/utilization/utilization-report";

/**
 * **Headcount** — billable staff in the period, split full-time vs hourly, with
 * joiners and departures, and the same cut per role. The one card the basis
 * toggle doesn't touch: these are roster facts, so there is no plan to compare
 * an actual against.
 */
export function HeadcountCard({ headcount }: { headcount: HeadcountSummary }) {
  return (
    <ReportSection
      title="Headcount"
      description="Billable staff on the roster during the period, and how that changed."
      caption="Overhead roles (leadership, sales, solutions, operations) are excluded throughout the report — they hold no project roles, so counting them would only dilute every utilization figure. Hourly staff stand in for part-time: the schema has no separate part-time employment type. Joiners and departures count start and termination dates falling inside the period, so someone who left mid-period still contributes the capacity and hours they had while here."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Total staff"
          value={formatCount(headcount.total)}
          hint={`${headcount.fullTime} full time · ${headcount.hourly} hourly`}
          icon={IconUsers}
        />
        <StatCard
          label="Joiners"
          value={formatCount(headcount.joiners)}
          hint="Started in this period"
          icon={IconUserPlus}
        />
        <StatCard
          label="Departures"
          value={formatCount(headcount.departures)}
          hint="Left in this period"
          icon={IconArrowRight}
        />
      </div>

      <div className="overflow-x-auto rounded border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Role</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Full time</TableHead>
              <TableHead className="text-right">Hourly</TableHead>
              <TableHead className="text-right">Joiners</TableHead>
              <TableHead className="text-right">Departures</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {headcount.byRole.map((row) => (
              <TableRow key={row.role ?? "unknown"}>
                <TableCell className="font-medium">
                  {row.role ? ROLE_LABELS[row.role] : "No role"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(row.total)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(row.fullTime)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(row.hourly)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(row.joiners)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(row.departures)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">All roles</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(headcount.total)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(headcount.fullTime)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(headcount.hourly)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(headcount.joiners)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCount(headcount.departures)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </ReportSection>
  );
}
