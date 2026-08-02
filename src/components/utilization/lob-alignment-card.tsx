import { EmptyState } from "@/components/empty-state";
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
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import {
  formatCount,
  formatHours,
  formatPercent,
} from "@/lib/utilization/utilization-format";
import type { LobAlignmentRow } from "@/lib/utilization/utilization-report";

/**
 * **Line of business alignment** — where the cohort's time actually sits. Each
 * working day defaults to the person's home line of business and is reassigned to
 * the line of business of whichever confirmed role they spend most of that day
 * on, so the planned shares always total 100%.
 *
 * The confirmed side counts logged hours instead of days, and attributes each
 * entry through the person's own role on that project. `projects` has no line of
 * business of its own — only its roles do — so hours logged against a project
 * someone was never staffed to fall back to their home line of business. That
 * fallback is the one place the two columns can legitimately disagree.
 */
export function LobAlignmentCard({ rows }: { rows: LobAlignmentRow[] }) {
  const totalDays = rows.reduce((sum, row) => sum + row.plannedDays, 0);
  const totalHours = rows.reduce(
    (sum, row) => sum + (row.confirmedHours ?? 0),
    0,
  );
  const hasConfirmed = rows.some((row) => row.confirmedHours != null);

  return (
    <ReportSection
      title="Line of business alignment"
      description="Which practices the cohort's working days and logged hours belong to."
      caption="Days on leave sit with the person's home line of business — nobody bills a practice while they're away. Tentative roles never move a day here, whatever the forecast toggle says: this asks where committed work sits."
    >
      {rows.length === 0 ? (
        <EmptyState bordered>
          No working days fall inside this period for the current cohort.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line of business</TableHead>
                <TableHead className="text-right">Planned days</TableHead>
                <TableHead className="text-right">Share</TableHead>
                <TableHead className="text-right">Confirmed hours</TableHead>
                <TableHead className="text-right">Share</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.lineOfBusiness}>
                  <TableCell className="font-medium">
                    {LINE_OF_BUSINESS_LABELS[row.lineOfBusiness]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCount(row.plannedDays)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(row.plannedShare)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatHours(row.confirmedHours)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatPercent(row.confirmedShare)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">All</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCount(totalDays)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {totalDays === 0 ? "—" : "100.0%"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {hasConfirmed ? formatHours(totalHours) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {hasConfirmed && totalHours > 0 ? "100.0%" : "—"}
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      )}
    </ReportSection>
  );
}
