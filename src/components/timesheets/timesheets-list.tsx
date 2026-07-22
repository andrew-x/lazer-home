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
import { formatDate } from "@/lib/format/format";
import { getWeekDays } from "@/lib/timesheets/timesheet-week";

type Props = {
  rows: TimesheetListRow[];
  /** Whether the viewer may edit each week (own + in window, or the capability). */
  canEdit: (weekStartDate: string) => boolean;
};

/** Format a week's Mon–Sun span, e.g. "Jul 13 – Jul 19, 2026". */
function weekRange(weekStartDate: string): string {
  const days = getWeekDays(weekStartDate);
  return `${formatDate(days[0])} – ${formatDate(days[6])}`;
}

/** The browse table of a person's timesheet weeks; each row links into its editor. */
export function TimesheetsList({ rows, canEdit }: Props) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Week</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Hours</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const editable = canEdit(row.weekStartDate);
            return (
              <TableRow key={row.weekStartDate}>
                <TableCell className="font-medium">
                  {weekRange(row.weekStartDate)}
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
                <TableCell className="text-right tabular-nums">
                  {row.totalHours || "—"}
                </TableCell>
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
