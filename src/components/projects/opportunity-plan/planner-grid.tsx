"use client";

import { IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { searchStaff } from "@/actions/projects/searchStaff";
import { EntityCombobox } from "@/components/form/entity-combobox";
import type { EntityOption } from "@/components/form/entity-multi-combobox";
import {
  PLANNER_LABEL_COL,
  PLANNER_SUB_LABEL_COL,
  PLANNER_WEEK_COL,
} from "@/components/planner/planner-columns";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { WORKING_DAYS_PER_WEEK } from "@/lib/allocations/allocations-grid";
import { cn } from "@/lib/core/utils";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { formatDate } from "@/lib/format/format";
import {
  type ExternalBlock,
  type OwnBlock,
  type PlannerRow,
  weekColumnLabel,
} from "@/lib/projects/project-planner-grid";
import { PROJECT_ROLE_STATUS_LABELS } from "@/lib/projects/project-role-status";
import { PROJECT_ROLE_TYPE_LABELS } from "@/lib/projects/project-role-type";

/** The block fill for a role's own load, by its edit state / status. */
function ownBlockClass(row: PlannerRow): string {
  if (row.editable) {
    return "border-primary bg-primary/15 font-medium text-foreground";
  }
  if (row.status === "confirmed") {
    return "border-primary/40 bg-primary/10 text-foreground";
  }
  // Tentative, from another opportunity — read-only, greyed.
  return "border-foreground/20 bg-foreground/10 text-muted-foreground";
}

export function PlannerGrid({
  rows,
  weekColumns,
  onEditRole,
  selectedRoleIds,
  onToggleSelect,
  onToggleSelectAll,
  onAssignStaff,
}: {
  rows: PlannerRow[];
  weekColumns: string[];
  onEditRole?: (roleId: string) => void;
  /** When provided, editable rows show a selection checkbox. */
  selectedRoleIds?: Set<string>;
  onToggleSelect?: (roleId: string) => void;
  onToggleSelectAll?: () => void;
  onAssignStaff?: (roleId: string, staffId: string | null) => void;
}) {
  const selectable = Boolean(onToggleSelect && selectedRoleIds);
  const editableIds = rows.filter((r) => r.editable).map((r) => r.roleId);
  const selectedCount = editableIds.filter((id) =>
    selectedRoleIds?.has(id),
  ).length;
  const allSelected =
    editableIds.length > 0 && selectedCount === editableIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="overflow-x-auto rounded-md border">
      {/* Raw <table> on purpose — NOT @/components/ui/table. This is a Gantt/
          planner grid with sticky lead columns and per-cell stacked blocks the
          shared Table primitives don't model. Don't "fix" this to use the UI
          Table or copy it for ordinary data tables. */}
      <table className="table-fixed border-collapse text-sm">
        <thead>
          <tr className="border-b">
            <th
              className={cn(
                PLANNER_LABEL_COL,
                "sticky left-0 z-10 bg-background px-3 py-2 text-left font-medium",
              )}
            >
              <div className="flex items-center gap-2">
                {selectable ? (
                  <Checkbox
                    checked={allSelected}
                    indeterminate={someSelected}
                    onCheckedChange={() => onToggleSelectAll?.()}
                    aria-label="Select all editable roles"
                    disabled={editableIds.length === 0}
                  />
                ) : null}
                Role
              </div>
            </th>
            <th
              className={cn(
                PLANNER_SUB_LABEL_COL,
                "sticky left-56 z-10 bg-background px-3 py-2 text-left font-medium",
              )}
            >
              Staff
            </th>
            {weekColumns.map((week) => (
              <th
                key={week}
                className={cn(
                  PLANNER_WEEK_COL,
                  "px-1 py-2 text-center text-xs font-medium text-muted-foreground",
                )}
              >
                {weekColumnLabel(week)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const canEdit = row.editable && Boolean(onEditRole);
            return (
              <tr key={row.key} className="border-b last:border-b-0">
                <td
                  className={cn(
                    PLANNER_LABEL_COL,
                    "sticky left-0 z-10 bg-background px-3 py-2 align-top",
                  )}
                >
                  <div className="flex items-start gap-2">
                    {selectable ? (
                      <div className="pt-0.5">
                        {row.editable ? (
                          <Checkbox
                            checked={selectedRoleIds?.has(row.roleId) ?? false}
                            onCheckedChange={() => onToggleSelect?.(row.roleId)}
                            aria-label={`Select ${row.roleLabel}`}
                          />
                        ) : (
                          <span className="block size-4" />
                        )}
                      </div>
                    ) : null}
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {row.roleLabel}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.roleTypeLabel} · {row.hoursPerDay}h/day
                      </div>
                      {canEdit ? (
                        <button
                          type="button"
                          onClick={() => onEditRole?.(row.roleId)}
                          className="mt-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                        >
                          <IconPencil className="size-3" />
                          Edit
                        </button>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td
                  className={cn(
                    PLANNER_SUB_LABEL_COL,
                    "sticky left-56 z-10 bg-background px-3 py-2 align-top",
                  )}
                >
                  <StaffCell row={row} onAssignStaff={onAssignStaff} />
                </td>
                {row.weeks.map((cell, i) => (
                  // Week columns are a fixed spine; index keys are stable here.
                  <td key={weekColumns[i]} className="px-1 py-1.5 align-top">
                    <div className="flex flex-col gap-1">
                      {cell.own ? (
                        <OwnBlockCell block={cell.own} row={row} />
                      ) : null}
                      {cell.external.map((block) => (
                        <ExternalBlockCell key={block.roleId} block={block} />
                      ))}
                    </div>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The Staff column: assigned name, an inline assign picker, or a dash. */
function StaffCell({
  row,
  onAssignStaff,
}: {
  row: PlannerRow;
  onAssignStaff?: (roleId: string, staffId: string | null) => void;
}) {
  if (row.staffName) {
    return <span className="block truncate font-medium">{row.staffName}</span>;
  }
  // Editable + unstaffed → an inline "Assign" picker; otherwise just a dash.
  if (row.editable && onAssignStaff) {
    return <AssignStaffPicker row={row} onAssignStaff={onAssignStaff} />;
  }
  return <span className="text-muted-foreground">—</span>;
}

/** Debounced staff picker that assigns the chosen person to this role. */
function AssignStaffPicker({
  row,
  onAssignStaff,
}: {
  row: PlannerRow;
  onAssignStaff: (roleId: string, staffId: string | null) => void;
}) {
  const [value, setValue] = useState<EntityOption | null>(null);
  return (
    <EntityCombobox
      value={value}
      onChange={(next) => {
        setValue(next);
        onAssignStaff(row.roleId, next?.id ?? null);
      }}
      searchAction={searchStaff}
      placeholder="Assign staff…"
    />
  );
}

/** This role's own load in a week — a filled block carrying its share of the week. */
function OwnBlockCell({ block, row }: { block: OwnBlock; row: PlannerRow }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className={cn(
              "relative flex items-baseline justify-center rounded-sm border px-2 py-1.5 text-xs leading-tight tabular-nums",
              ownBlockClass(row),
            )}
          >
            {block.isStart ? (
              <span className="absolute inset-y-0 left-0 w-1 rounded-l-sm bg-primary" />
            ) : null}
            {block.isEnd ? (
              <span className="absolute inset-y-0 right-0 w-1 rounded-r-sm bg-primary" />
            ) : null}
            {block.percent}%
          </div>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5">
        <span className="font-medium">{row.roleLabel}</span>
        <span>{row.roleTypeLabel}</span>
        <span>
          {formatDate(row.startDate)} – {formatDate(row.endDate)}
        </span>
        <span>{row.hoursPerDay * WORKING_DAYS_PER_WEEK} hrs/week</span>
        <span className="text-background/70">
          {PROJECT_ROLE_STATUS_LABELS[row.status]} · {block.percent}% of week
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

/** The assignee's commitment on another project — a greyed block, name + %. */
function ExternalBlockCell({ block }: { block: ExternalBlock }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="relative flex items-baseline justify-between gap-1.5 rounded-sm border border-dashed border-foreground/20 bg-foreground/[0.04] px-2 py-1.5 text-xs leading-tight text-muted-foreground">
            <span className="truncate font-medium">{block.projectName}</span>
            <span className="shrink-0 tabular-nums">{block.percent}%</span>
          </div>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5">
        <span className="font-medium">{block.projectName}</span>
        <span>
          {block.description ?? PROJECT_ROLE_TYPE_LABELS[block.roleType]}
          {" · "}
          {LINE_OF_BUSINESS_LABELS[block.lineOfBusiness]}
        </span>
        <span>
          {formatDate(block.startDate)} – {formatDate(block.endDate)}
        </span>
        <span className="text-background/70">
          {PROJECT_ROLE_STATUS_LABELS[block.status]} · {block.percent}% of week
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export function PlannerLegend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-primary bg-primary/15" />
        This deal
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-primary/40 bg-primary/10" />
        Confirmed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm border border-dashed border-foreground/20 bg-foreground/[0.04]" />
        Other allocation (elsewhere)
      </span>
    </div>
  );
}
