import Link from "next/link";
import type { MyAllocationRole } from "@/actions/allocations/getMyAllocations";
import { EmptyState } from "@/components/empty-state";
import { ROOMY_TABLE } from "@/components/table-density";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateRange } from "@/lib/format/format";
import type { MyAllocationRow } from "@/lib/home/my-work";
import { buildMyAllocationRows } from "@/lib/home/my-work";
import { PROJECT_ROLE_STATUS_VARIANTS } from "@/lib/projects/project-role-status";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

/**
 * What the signed-in person is allocated to — project, client, dates, hours a day.
 *
 * This **replaced** two widgets that between them never answered the question: a
 * stat tile that counted active projects and listed their names in a hint string,
 * and a gantt that drew the same projects as bars. A gantt shows *shape*; the thing
 * people actually need off a dashboard is the figures — when does this start, when
 * does it end, how much of me does it want. So: a table.
 *
 * **No link to the planner.** This section is about your own commitments, and the
 * planner is a staffing tool for someone else's job.
 *
 * Live work sorts first (heaviest commitment first), then upcoming work by start
 * date, with a divider between — "what I'm on" and "what's next" are different
 * questions and the eye shouldn't have to sort dates to separate them.
 */
export function MyAllocationsTable({
  roles,
  today,
}: {
  roles: MyAllocationRole[];
  today: string;
}) {
  const { live, upcoming } = buildMyAllocationRows(roles, today);

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Your allocations</CardTitle>
      </CardHeader>
      <CardContent>
        {live.length === 0 && upcoming.length === 0 ? (
          <EmptyState>
            You&apos;re not allocated to anything right now.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <Table className={ROOMY_TABLE}>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Hours/day</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {live.map((row) => (
                  <AllocationRow key={row.key} row={row} />
                ))}
                {upcoming.length > 0 ? (
                  <>
                    <TableRow className="hover:bg-transparent">
                      <TableCell
                        colSpan={4}
                        className="pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                      >
                        Upcoming
                      </TableCell>
                    </TableRow>
                    {upcoming.map((row) => (
                      <AllocationRow key={row.key} row={row} />
                    ))}
                  </>
                ) : null}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AllocationRow({ row }: { row: MyAllocationRow }) {
  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={`/projects/${row.projectId}`}
            className="font-medium text-primary hover:underline"
          >
            {row.projectName}
          </Link>
          {row.status === "tentative" ? (
            <Badge
              variant={PROJECT_ROLE_STATUS_VARIANTS.tentative}
              className="font-normal"
            >
              Tentative
            </Badge>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {row.roleTypes
            .map((type) => PROJECT_ROLE_TYPE_LABELS[type])
            .join(" · ")}
        </p>
      </TableCell>
      <TableCell className="text-muted-foreground">{row.companyName}</TableCell>
      <TableCell className="whitespace-nowrap">
        {formatDateRange(row.startDate, row.endDate)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.hoursPerDay.toFixed(1)}
      </TableCell>
    </TableRow>
  );
}
