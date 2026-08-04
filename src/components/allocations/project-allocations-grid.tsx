"use client";

import {
  IconChevronDown,
  IconChevronRight,
  IconExternalLink,
} from "@tabler/icons-react";
import Link from "next/link";
import { Fragment } from "react";
import type { ProjectAllocationRoleRow } from "@/actions/allocations/getProjectAllocationsGrid";
import {
  CONFIRMED_BLOCK,
  LegendEdgeItem,
  LegendItem,
  LegendRow,
  TENTATIVE_BLOCK,
} from "@/components/allocations/allocations-grid";
import {
  PLANNER_COLUMN_WIDTH,
  PLANNER_LABEL_COL,
  PLANNER_UNIT_NOUN,
  plannerTableWidth,
} from "@/components/planner/planner-columns";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  columnLabel,
  type Granularity,
  WORKING_DAYS_PER_WEEK,
} from "@/lib/allocations/allocations-grid";
import type {
  ProjectAllocationRow,
  ProjectRoleCell,
  ProjectSummaryCell,
} from "@/lib/allocations/project-allocations-grid";
import { cn } from "@/lib/core/utils";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatDate } from "@/lib/format/format";
import {
  PROJECT_ROLE_STATUS_LABELS,
  ROLE_STATUS,
} from "@/lib/projects/project-role-status";
import {
  DELIVERY_SUBROW_CLASS,
  isDeliveryDiscipline,
  PROJECT_ROLE_TYPE_LABELS,
} from "@/lib/projects/project-role-type";
import { isWeekend } from "@/lib/timesheets/timesheet-week";

/**
 * An open position's block. Deliberately *not* the tentative style: tentative is
 * about whether the work is won, unstaffed is about whether anyone is doing it,
 * and conflating the two hides the gap this view exists to surface. Neutral and
 * dashed — clearly a hole, not a commitment.
 */
const UNALLOCATED_BLOCK =
  "border border-dashed border-foreground/30 bg-foreground/[0.03] text-muted-foreground";

/**
 * The by-project allocations planner grid: a sticky project column whose rows
 * expand into their roles, and one column per bucket (day, week, or month). A
 * collapsed project still reads — its cells carry the bucket's total FTE and how
 * many roles are still open. A role's cell shows the person filling it, or an
 * **Unallocated** block, both with the role's share of the bucket.
 *
 * A deliberately hand-rolled `<table>` (like `AllocationsGrid` and the opportunity
 * `PlannerGrid`) — NOT `@/components/ui/table`, and NOT `EditableTable`, which
 * renders exactly one `<tr>` per row and so has nowhere to put the role subrows.
 */
export function ProjectAllocationsGrid({
  rows,
  columns,
  granularity,
  expanded,
  onToggleProject,
  canAllocate,
  onStaffRole,
}: {
  rows: ProjectAllocationRow[];
  columns: string[];
  granularity: Granularity;
  /** Project ids whose role subrows are showing. */
  expanded: Set<string>;
  onToggleProject: (projectId: string) => void;
  /** Make "Unallocated" blocks actionable (viewer holds `projects.edit`). */
  canAllocate: boolean;
  /** Open the staffing dialog for an open role. */
  onStaffRole: (role: ProjectAllocationRoleRow) => void;
}) {
  const unit = PLANNER_UNIT_NOUN[granularity];
  const width = PLANNER_COLUMN_WIDTH[granularity];
  const dimmed = (col: string) => granularity === "day" && isWeekend(col);

  return (
    <div className="overflow-x-auto rounded-md border">
      {/* The explicit width is what makes `table-fixed` bind, and so what keeps a
          column the same width whether a project's roles are collapsed or
          expanded — see `plannerTableWidth`. */}
      <table
        className="table-fixed border-collapse text-sm"
        style={plannerTableWidth(granularity, columns.length)}
      >
        <thead>
          <tr className="border-b">
            <th
              className={cn(
                PLANNER_LABEL_COL,
                "sticky left-0 z-10 bg-background px-3 py-2.5 text-left font-medium",
              )}
            >
              Project
            </th>
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
          {rows.map((row) => {
            const isOpen = expanded.has(row.projectId);
            return (
              <Fragment key={row.projectId}>
                <tr className="border-b bg-muted/30">
                  <td
                    className={cn(
                      PLANNER_LABEL_COL,
                      "sticky left-0 z-10 bg-muted/30 px-3 py-2 align-top",
                    )}
                  >
                    <div className="flex min-w-0 items-center gap-1">
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        onClick={() => onToggleProject(row.projectId)}
                        className="flex min-w-0 flex-1 items-center gap-1 text-left"
                      >
                        {isOpen ? (
                          <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 truncate font-medium">
                          {row.projectName}
                        </span>
                      </button>
                      {/* The row itself expands, so the project link is its own
                          small affordance rather than the name — otherwise the
                          view's primary interaction would be a 16px chevron. */}
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Link
                              href={`/projects/${row.projectId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              aria-label={`Open ${row.projectName}`}
                              className="shrink-0 rounded-sm p-0.5 text-muted-foreground hover:text-foreground"
                            >
                              <IconExternalLink className="size-4" />
                            </Link>
                          }
                        />
                        <TooltipContent>Open {row.projectName}</TooltipContent>
                      </Tooltip>
                    </div>
                    <div className="truncate pl-5 text-xs text-muted-foreground">
                      {row.companyName}
                    </div>
                  </td>
                  {row.cells.map((cell, i) => (
                    // Columns are a fixed spine; index keys are stable here.
                    <td
                      key={columns[i]}
                      className={cn(
                        "px-1 py-2 align-top",
                        dimmed(columns[i]) && "bg-muted/40",
                      )}
                    >
                      <SummaryCell cell={cell} />
                    </td>
                  ))}
                </tr>
                {isOpen
                  ? row.roles.map((line) => {
                      const isDelivery = isDeliveryDiscipline(
                        line.role.roleType,
                      );
                      return (
                        <tr
                          key={line.role.id}
                          className={cn(
                            "border-b",
                            isDelivery && DELIVERY_SUBROW_CLASS,
                          )}
                        >
                          <td
                            className={cn(
                              PLANNER_LABEL_COL,
                              "sticky left-0 z-10 py-2 pr-3 pl-8 align-top",
                              // Sticky, so it paints its own background and has to
                              // repeat the row's tint.
                              isDelivery
                                ? DELIVERY_SUBROW_CLASS
                                : "bg-background",
                            )}
                          >
                            <div className="truncate">
                              {roleLabel(line.role)}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {roleSublabel(line.role)}
                            </div>
                          </td>
                          {line.cells.map((cell, i) => (
                            <td
                              key={columns[i]}
                              className={cn(
                                "px-1 py-1.5 align-top",
                                dimmed(columns[i]) && "bg-muted/30",
                              )}
                            >
                              {cell.percent > 0 ? (
                                <RoleBlock
                                  role={line.role}
                                  cell={cell}
                                  unit={unit}
                                  canAllocate={canAllocate}
                                  onStaffRole={onStaffRole}
                                />
                              ) : null}
                            </td>
                          ))}
                        </tr>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The role's own name: its description if it has one, else its discipline. */
function roleLabel(role: ProjectAllocationRoleRow): string {
  return role.description ?? PROJECT_ROLE_TYPE_LABELS[role.roleType];
}

/** "Engineer · Core" beneath the role name (drops the type when it's the label). */
function roleSublabel(role: ProjectAllocationRoleRow): string {
  const lob = LINE_OF_BUSINESS_LABELS[role.lineOfBusiness];
  return role.description
    ? `${PROJECT_ROLE_TYPE_LABELS[role.roleType]} · ${lob}`
    : lob;
}

/**
 * A project row's rollup for one bucket: total planned load as FTE, plus how many
 * of its roles nobody is in. Blank when the project isn't running that bucket.
 */
function SummaryCell({ cell }: { cell: ProjectSummaryCell }) {
  if (cell.roleCount === 0) return null;
  return (
    <div className="flex flex-col items-center gap-0.5 text-xs leading-tight">
      <span className="font-medium tabular-nums">{cell.fte} FTE</span>
      {cell.openCount > 0 ? (
        <span className="tabular-nums text-muted-foreground">
          {cell.openCount} open
        </span>
      ) : null}
    </div>
  );
}

/**
 * One role's block in a bucket: the person filling it (linking to their profile),
 * or an **Unallocated** block that opens the staffing dialog for viewers holding
 * `projects.edit`. A solid bar on the leading/trailing edge marks the column the
 * role starts/ends in, exactly as the staff view does.
 */
function RoleBlock({
  role,
  cell,
  unit,
  canAllocate,
  onStaffRole,
}: {
  role: ProjectAllocationRoleRow;
  cell: ProjectRoleCell;
  unit: string;
  canAllocate: boolean;
  onStaffRole: (role: ProjectAllocationRoleRow) => void;
}) {
  const open = role.staffId === null;
  const confirmed = role.status === ROLE_STATUS.confirmed;
  const actionable = open && canAllocate;

  const body = (
    <>
      {cell.isStart ? (
        <span className="absolute inset-y-0 left-0 w-1 rounded-l-sm bg-primary" />
      ) : null}
      {cell.isEnd ? (
        <span className="absolute inset-y-0 right-0 w-1 rounded-r-sm bg-primary" />
      ) : null}
      {open ? (
        <span className="truncate font-medium">Unallocated</span>
      ) : (
        <Link
          href={`/staff/${role.staffId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="truncate font-medium hover:underline"
        >
          {role.staffName}
        </Link>
      )}
      <span className="shrink-0 tabular-nums text-muted-foreground">
        {cell.percent}%
      </span>
    </>
  );

  const className = cn(
    "relative flex w-full items-baseline justify-between gap-1.5 rounded-sm px-2 py-1.5 text-left text-xs leading-tight",
    open
      ? UNALLOCATED_BLOCK
      : cn(confirmed ? CONFIRMED_BLOCK : TENTATIVE_BLOCK, "text-foreground"),
    actionable && "hover:border-primary/50 hover:bg-primary/[0.06]",
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          actionable ? (
            <button
              type="button"
              onClick={() => onStaffRole(role)}
              className={className}
            >
              {body}
            </button>
          ) : (
            <div className={className}>{body}</div>
          )
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5">
        <span className="font-medium">{roleLabel(role)}</span>
        <span>
          {PROJECT_ROLE_TYPE_LABELS[role.roleType]}
          {" · "}
          {LINE_OF_BUSINESS_LABELS[role.lineOfBusiness]}
        </span>
        <span>
          {formatDate(role.startDate)} – {formatDate(role.endDate)}
        </span>
        <span>{role.hoursPerDay * WORKING_DAYS_PER_WEEK} hrs/week</span>
        <span className="text-background/70">
          {PROJECT_ROLE_STATUS_LABELS[role.status]} · {cell.percent}% of {unit}
        </span>
        {open ? (
          <span className="text-background/70">
            {canAllocate
              ? "Open position — click to staff it"
              : "Open position"}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** Legend for the by-project view — no time off (that's a property of a person). */
export function ProjectAllocationsLegend() {
  return (
    <LegendRow>
      <LegendItem className={CONFIRMED_BLOCK}>Confirmed</LegendItem>
      <LegendItem className={TENTATIVE_BLOCK}>Tentative</LegendItem>
      <LegendItem className={UNALLOCATED_BLOCK}>Unallocated</LegendItem>
      <LegendEdgeItem />
    </LegendRow>
  );
}
