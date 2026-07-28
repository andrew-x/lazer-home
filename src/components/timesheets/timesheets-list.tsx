import Link from "next/link";
import type { TimesheetListRow } from "@/actions/timesheets/getTimesheetList";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/core/utils";
import { formatWeekRange } from "@/lib/timesheets/timesheet-week";

type Props = {
  rows: TimesheetListRow[];
  /** Whether the viewer may edit each week (own + in window, or the capability). */
  canEdit: (weekStartDate: string) => boolean;
};

/** An hours cell: right-aligned, and blank rather than a bare zero. */
function HoursCell({ hours, bold }: { hours: number; bold?: boolean }) {
  return (
    <TableCell className={cn("text-right tabular-nums", bold && "font-medium")}>
      {hours || "—"}
    </TableCell>
  );
}

/**
 * The browse table of a person's timesheet weeks; each row links into its editor.
 * The hour columns partition the week — PTO is broken out of the other
 * non-billable buckets, so Project + PTO + Non-billable = Total.
 */
export function TimesheetsList({ rows, canEdit }: Props) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Week</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Project</TableHead>
            <TableHead className="text-right">PTO</TableHead>
            <TableHead className="text-right">Non-billable</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const editable = canEdit(row.weekStartDate);
            return (
              <TableRow key={row.weekStartDate}>
                <TableCell className="font-medium">
                  {formatWeekRange(row.weekStartDate)}
                </TableCell>
                <TableCell>
                  {!row.started ? (
                    <span className="text-sm text-muted-foreground">
                      Not started
                    </span>
                  ) : (
                    <Badge
                      variant={
                        row.status === "submitted" ? "secondary" : "outline"
                      }
                    >
                      {row.status === "submitted" ? "Submitted" : "Draft"}
                    </Badge>
                  )}
                </TableCell>
                <HoursCell hours={row.projectHours} />
                <HoursCell hours={row.ptoHours} />
                <HoursCell hours={row.nonBillableHours} />
                <HoursCell hours={row.totalHours} bold />
                <TableCell className="text-right">
                  <Button
                    variant={editable ? "default" : "outline"}
                    size="sm"
                    render={<Link href={`/timesheets/${row.weekStartDate}`} />}
                  >
                    {editable ? "Edit" : "View"}
                  </Button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
