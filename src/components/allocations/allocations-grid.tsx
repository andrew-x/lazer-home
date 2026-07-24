"use client";

import Link from "next/link";
import {
  PLANNER_LABEL_COL,
  PLANNER_WEEK_COL,
} from "@/components/planner/planner-columns";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  type AllocationCell,
  type AllocationRow,
  type TimeOffCell,
  WORKING_DAYS_PER_WEEK,
  weekColumnLabel,
} from "@/lib/allocations/allocations-grid";
import { cn } from "@/lib/core/utils";
import {
  LINE_OF_BUSINESS_LABELS,
  type LineOfBusiness,
} from "@/lib/crm/line-of-business";
import { formatDate } from "@/lib/format/format";
import { PROJECT_ROLE_STATUS_LABELS } from "@/lib/projects/project-role-status";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";
import {
  EMPLOYMENT_TYPE_LABELS,
  PTO_TYPE_LABELS,
  ROLE_LABELS,
} from "@/lib/staff/staff-enums";

/**
 * The allocations planner grid: a sticky staff column and one column per week.
 * A filled cell shows each project the person is allocated to that week, with
 * its share of a 40-hour week; a tooltip carries the project, role, duration,
 * and status. Confirmed roles read as a solid block, tentative as a dashed
 * outline. A neutral "Away" strip marks time off.
 *
 * A deliberately hand-rolled `<table>` (like the opportunity `PlannerGrid`) —
 * NOT `@/components/ui/table`: the sticky first column and per-cell stacked
 * blocks aren't something the shared Table primitives model.
 */
export function AllocationsGrid({
  rows,
  weekColumns,
}: {
  rows: AllocationRow[];
  weekColumns: string[];
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th
              className={cn(
                PLANNER_LABEL_COL,
                "sticky left-0 z-10 bg-background px-3 py-2.5 text-left font-medium",
              )}
            >
              Staff
            </th>
            {weekColumns.map((week) => (
              <th
                key={week}
                className={cn(
                  PLANNER_WEEK_COL,
                  "px-1 py-2.5 text-center text-xs font-medium text-muted-foreground",
                )}
              >
                {weekColumnLabel(week)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.staffId} className="border-b last:border-b-0">
              <td
                className={cn(
                  PLANNER_LABEL_COL,
                  "sticky left-0 z-10 bg-background px-3 py-2 align-top",
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <Link
                    href={`/staff/${row.staffId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  {row.employmentType === "HOURLY" ? (
                    <Badge variant="outline" className="shrink-0 font-normal">
                      {EMPLOYMENT_TYPE_LABELS.HOURLY}
                    </Badge>
                  ) : null}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {staffSublabel(row)}
                </div>
              </td>
              {row.weeks.map((cell, i) => (
                // Week columns are a fixed spine; index keys are stable here.
                <td key={weekColumns[i]} className="px-1 py-1.5 align-top">
                  <div className="flex flex-col gap-1">
                    {cell.timeOff ? <TimeOffBlock cell={cell.timeOff} /> : null}
                    {cell.allocations.map((allocation) => (
                      <AllocationBlock
                        key={allocation.roleId}
                        allocation={allocation}
                      />
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Role + line of business beneath the staff name, e.g. "Engineer · Core". */
function staffSublabel(row: AllocationRow): string {
  const parts: string[] = [];
  if (row.role) parts.push(ROLE_LABELS[row.role]);
  if (row.lineOfBusiness) {
    parts.push(LINE_OF_BUSINESS_LABELS[row.lineOfBusiness as LineOfBusiness]);
  }
  return parts.join(" · ");
}

/**
 * One project allocation for a week: project name + percentage, with a tooltip.
 * Confirmed reads as an indigo fill, tentative as a dashed indigo outline. A
 * solid bar on the leading/trailing edge marks the week the role starts/ends.
 */
function AllocationBlock({ allocation }: { allocation: AllocationCell }) {
  const confirmed = allocation.status === "confirmed";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn(
              "relative flex items-baseline justify-between gap-1.5 rounded-sm px-2 py-1.5 text-xs leading-tight text-foreground",
              confirmed
                ? "border border-primary/40 bg-primary/10"
                : "border border-dashed border-primary/50 bg-primary/[0.04]",
            )}
          >
            {allocation.isStart ? (
              <span className="absolute inset-y-0 left-0 w-1 rounded-l-sm bg-primary" />
            ) : null}
            {allocation.isEnd ? (
              <span className="absolute inset-y-0 right-0 w-1 rounded-r-sm bg-primary" />
            ) : null}
            <span className="truncate font-medium">
              {allocation.projectName}
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {allocation.percent}%
            </span>
          </div>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5">
        <span className="font-medium">{allocation.projectName}</span>
        <span>
          {allocation.description ??
            PROJECT_ROLE_TYPE_LABELS[allocation.roleType]}
          {" · "}
          {LINE_OF_BUSINESS_LABELS[allocation.lineOfBusiness]}
        </span>
        <span>
          {formatDate(allocation.startDate)} – {formatDate(allocation.endDate)}
        </span>
        <span>{allocation.hoursPerDay * WORKING_DAYS_PER_WEEK} hrs/week</span>
        <span className="text-background/70">
          {PROJECT_ROLE_STATUS_LABELS[allocation.status]} · {allocation.percent}
          % of week
        </span>
        {allocation.isStart || allocation.isEnd ? (
          <span className="text-background/70">
            {startEndNote(allocation.isStart, allocation.isEnd)}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** "Starts this week" / "Ends this week" / "Starts & ends this week". */
function startEndNote(isStart: boolean, isEnd: boolean): string {
  if (isStart && isEnd) return "Starts & ends this week";
  return isStart ? "Starts this week" : "Ends this week";
}

/**
 * An "Away" strip (amber, clearly not work) with the share of the week the
 * person is out. The leave reason shows in the tooltip only when the viewer may
 * see it.
 */
function TimeOffBlock({ cell }: { cell: TimeOffCell }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="flex items-baseline justify-between gap-1.5 rounded-sm border border-amber-300 bg-amber-100 px-2 py-1.5 text-xs leading-tight text-amber-900">
            <span className="font-medium">Away</span>
            <span className="shrink-0 tabular-nums text-amber-900/70">
              {cell.percent}%
            </span>
          </div>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5">
        <span>
          {cell.type ? PTO_TYPE_LABELS[cell.type] : "Time off"} · {cell.percent}
          % of week
        </span>
        <span>
          {formatDate(cell.startDate)} – {formatDate(cell.endDate)}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** Legend for the confirmed / tentative / time-off styles and the start/end mark. */
export function AllocationsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-primary/40 bg-primary/10" />
        Confirmed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-dashed border-primary/50 bg-primary/[0.04]" />
        Tentative
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-amber-300 bg-amber-100" />
        Time off
      </span>
      <span className="flex items-center gap-1.5">
        <span className="relative inline-block h-3 w-5 rounded-sm border border-primary/40 bg-primary/10">
          <span className="absolute inset-y-0 left-0 w-0.5 rounded-l-sm bg-primary" />
          <span className="absolute inset-y-0 right-0 w-0.5 rounded-r-sm bg-primary" />
        </span>
        Role starts / ends
      </span>
    </div>
  );
}
