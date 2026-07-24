"use client";

import Link from "next/link";
import { AllocationNoteCell } from "@/components/allocations/allocation-note-cell";
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
  columnLabel,
  type Granularity,
  type TimeOffCell,
  WORKING_DAYS_PER_WEEK,
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
import { isWeekend } from "@/lib/timesheets/timesheet-week";

/** The noun a cell's percentage is "% of", by granularity. */
const UNIT_NOUN: Record<Granularity, string> = {
  day: "day",
  week: "week",
  month: "month",
};

/**
 * Column width per granularity — days pack tighter, months breathe. Fixed
 * (w/min-w/max-w) so `table-fixed` widths stay authoritative; the week bucket
 * reuses the shared PLANNER_WEEK_COL so allocations line up with the other
 * planner grids.
 */
const COLUMN_WIDTH: Record<Granularity, string> = {
  day: "w-24 min-w-24 max-w-24",
  week: PLANNER_WEEK_COL,
  month: "w-32 min-w-32 max-w-32",
};

/**
 * The allocations planner grid: a sticky staff column and one column per bucket
 * (day, week, or month). A filled cell shows each project the person is allocated
 * to that column, with its share of the column; a tooltip carries the project,
 * role, duration, and status. Confirmed roles read as a solid block, tentative as
 * a dashed outline. A neutral "Away" strip marks time off. In the daily view,
 * weekend columns are dimmed — the allocation model only counts weekdays.
 *
 * A deliberately hand-rolled `<table>` (like the opportunity `PlannerGrid`) —
 * NOT `@/components/ui/table`: the sticky first column and per-cell stacked
 * blocks aren't something the shared Table primitives model.
 */
export function AllocationsGrid({
  rows,
  columns,
  granularity,
  canEditNotes,
}: {
  rows: AllocationRow[];
  columns: string[];
  granularity: Granularity;
  /** Render the manager-only Notes column (viewer holds `staff.edit`). */
  canEditNotes: boolean;
}) {
  const unit = UNIT_NOUN[granularity];
  const width = COLUMN_WIDTH[granularity];
  const dimmed = (col: string) => granularity === "day" && isWeekend(col);

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
            {canEditNotes ? (
              <th className="min-w-56 px-3 py-2.5 text-left font-medium">
                Allocation note
              </th>
            ) : null}
            {columns.map((col) => (
              <th
                key={col}
                className={cn(
                  "px-1 py-2.5 text-center text-xs font-medium text-muted-foreground",
                  width,
                  dimmed(col) && "bg-muted/30 text-muted-foreground/50",
                )}
              >
                {columnLabel(granularity, col)}
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
              {canEditNotes ? (
                <td className="min-w-56 max-w-72 px-2 py-1.5 align-top">
                  <AllocationNoteCell
                    staffId={row.staffId}
                    initialNotes={row.allocationNotes}
                  />
                </td>
              ) : null}
              {row.cells.map((cell, i) => (
                // Columns are a fixed spine; index keys are stable here.
                <td
                  key={columns[i]}
                  className={cn(
                    "px-1 py-1.5 align-top",
                    dimmed(columns[i]) && "bg-muted/30",
                  )}
                >
                  <div className="flex flex-col gap-1">
                    {cell.timeOff ? (
                      <TimeOffBlock cell={cell.timeOff} unit={unit} />
                    ) : null}
                    {cell.allocations.map((allocation) => (
                      <AllocationBlock
                        key={allocation.roleId}
                        allocation={allocation}
                        unit={unit}
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
 * One project allocation for a column: project name + percentage, with a tooltip.
 * Confirmed reads as an indigo fill, tentative as a dashed indigo outline. A
 * solid bar on the leading/trailing edge marks the column the role starts/ends.
 */
function AllocationBlock({
  allocation,
  unit,
}: {
  allocation: AllocationCell;
  unit: string;
}) {
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
            <Link
              href={`/projects/${allocation.projectId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate font-medium hover:underline"
            >
              {allocation.projectName}
            </Link>
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
          % of {unit}
        </span>
        {allocation.isStart || allocation.isEnd ? (
          <span className="text-background/70">
            {startEndNote(allocation.isStart, allocation.isEnd, unit)}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** "Starts this week" / "Ends this month" / "Starts & ends this day". */
function startEndNote(isStart: boolean, isEnd: boolean, unit: string): string {
  if (isStart && isEnd) return `Starts & ends this ${unit}`;
  return isStart ? `Starts this ${unit}` : `Ends this ${unit}`;
}

/**
 * An "Away" strip (amber, clearly not work) with the share of the column the
 * person is out. The leave reason shows in the tooltip only when the viewer may
 * see it.
 */
function TimeOffBlock({ cell, unit }: { cell: TimeOffCell; unit: string }) {
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
          % of {unit}
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
