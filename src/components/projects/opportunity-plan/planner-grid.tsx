"use client";

import { IconAlertTriangle, IconPencil } from "@tabler/icons-react";
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
import {
  aggregateMoneyFormatters,
  type Currency,
  formatAmount,
  formatMoney,
} from "@/lib/format/currency";
import { formatDate, formatPercent } from "@/lib/format/format";
import { BILL_RATE_CURRENCY } from "@/lib/projects/bill-rates";
import {
  marginAmountTone,
  type RoleCostBasis,
  type RoleMargin,
} from "@/lib/projects/project-margin";
import {
  type ExternalBlock,
  type OwnBlock,
  type PlannerRow,
  weekColumnLabel,
} from "@/lib/projects/project-planner-grid";
import {
  PROJECT_ROLE_STATUS_LABELS,
  ROLE_STATUS,
} from "@/lib/projects/project-role-status";
import {
  DELIVERY_ROW_CLASS,
  PROJECT_ROLE_TYPE_LABELS,
} from "@/lib/projects/project-role-type";

/**
 * The block fill for a role's own load. Emphasis (the current deal's own lines)
 * wins where it applies; otherwise the fill reads the role's status, which is what
 * the project page's timeline relies on — there every row is editable, so keying
 * this off `editable` would flatten confirmed and tentative into one colour.
 */
function ownBlockClass(row: PlannerRow): string {
  if (row.emphasized) {
    return "border-primary bg-primary/15 font-medium text-foreground";
  }
  if (row.status === ROLE_STATUS.confirmed) {
    return "border-primary/40 bg-primary/10 text-foreground";
  }
  // Tentative — greyed (another opportunity's line, or simply not yet won).
  return "border-foreground/20 bg-foreground/10 text-muted-foreground";
}

/**
 * Per-role money for the grid. One optional prop so "off" — no budget, or a viewer
 * without `projects.viewMargin` — is a single `undefined` rather than several flags.
 */
export type PlannerMargins = {
  byRoleId: Map<string, RoleMargin>;
  currency: Currency;
};

export function PlannerGrid({
  rows,
  weekColumns,
  onEditRole,
  selectedRoleIds,
  onToggleSelect,
  onToggleSelectAll,
  onAssignStaff,
  margins,
}: {
  rows: PlannerRow[];
  weekColumns: string[];
  onEditRole?: (roleId: string) => void;
  /** When provided, editable rows show a selection checkbox. */
  selectedRoleIds?: Set<string>;
  onToggleSelect?: (roleId: string) => void;
  onToggleSelectAll?: () => void;
  onAssignStaff?: (roleId: string, staffId: string | null) => void;
  /** Omit to render no money at all. */
  margins?: PlannerMargins;
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
              <tr
                key={row.key}
                className={cn(
                  "border-b last:border-b-0",
                  row.isDelivery && DELIVERY_ROW_CLASS,
                )}
              >
                <td
                  className={cn(
                    PLANNER_LABEL_COL,
                    "sticky left-0 z-10 px-3 py-2 align-top",
                    // The label column is sticky, so it paints its own background —
                    // it has to repeat the row's tint or it punches a hole in it.
                    row.isDelivery ? DELIVERY_ROW_CLASS : "bg-background",
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
                        {/* Only when the rate is off the card. One extra token on the
                            exception and silence on the norm — a rate on every row
                            would be noise, and a fourth line would make every planner
                            in the app taller. */}
                        {row.offStandardRate
                          ? ` · ${formatMoney(
                              row.billRate,
                              BILL_RATE_CURRENCY,
                              {
                                minimumFractionDigits: 0,
                                maximumFractionDigits: 2,
                              },
                            )}/hr`
                          : null}
                      </div>
                      {margins ? (
                        <RoleMarginLine
                          margin={margins.byRoleId.get(row.roleId)}
                          currency={margins.currency}
                        />
                      ) : null}
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
                    "sticky left-56 z-10 px-3 py-2 align-top",
                    // The *second* sticky column, and it paints its own background
                    // too — so the tint has to be repeated here as well or the row
                    // reads as striped across the Staff column.
                    row.isDelivery ? DELIVERY_ROW_CLASS : "bg-background",
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

/**
 * A role's money, as a third line in the sticky label cell: the margin percentage
 * for a time-and-materials plan, or just the cost for a fixed fee (where revenue
 * isn't attributable to a role). The tooltip carries the breakdown and, crucially,
 * *where the cost came from* — an averaged figure must never read as a real person's
 * pay.
 *
 * A line here rather than a new lead column: the two sticky columns are positioned by
 * a hardcoded `left-56` twinned to `PLANNER_LABEL_COL`, and those widths are shared
 * with the allocations grid, so a third one would shift the week spine on every
 * planner. It also stays scannable straight down the column, which a per-cell tooltip
 * or an expandable row would not.
 */
function RoleMarginLine({
  margin,
  currency,
}: {
  margin: RoleMargin | undefined;
  currency: Currency;
}) {
  if (!margin) return null;

  const { money } = aggregateMoneyFormatters(currency);

  if (!margin.counted) {
    return (
      <div className="mt-0.5 text-xs text-muted-foreground">
        Excluded from budget
      </div>
    );
  }

  // Show the most complete true statement available, and no more: a margin when
  // both sides are known, else the cost (a fixed fee, where revenue isn't
  // attributable per role), else the revenue — which is what a viewer without
  // `projects.viewMargin` gets, since cost never reaches them.
  //
  // Always led by the amount, matching the summary panel: the money is the figure
  // being judged, and the percentage is how to read it (it's in the tooltip).
  const showsMargin = margin.margin != null;
  const label = showsMargin
    ? `${money(margin.margin)} margin`
    : margin.cost
      ? `${money(margin.cost)} cost`
      : margin.revenue
        ? `${money(margin.revenue)} revenue`
        : null;

  // Nothing true to say — an unpriced role with no visible cost. The summary panel
  // counts these, so a bare em dash here would be noise.
  if (label == null) return null;

  const costBasisNote = COST_BASIS_LABEL[margin.costBasis];

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div className="mt-0.5 flex items-center gap-1 text-xs tabular-nums">
            <span
              className={cn(
                "text-muted-foreground",
                showsMargin && marginAmountTone(margin.margin),
              )}
            >
              {label}
            </span>
            {margin.costBasis === "UNKNOWN" ? (
              <IconAlertTriangle
                className="size-3.5 shrink-0 text-muted-foreground"
                aria-label="No compensation on record, so this role has no cost"
              />
            ) : null}
          </div>
        }
      />
      <TooltipContent className="flex-col items-start gap-0.5">
        <span>{formatAmount(Math.round(margin.hours))} hrs</span>
        {margin.revenue ? (
          <span>Revenue {money(margin.revenue)}</span>
        ) : (
          <span className="text-background/70">
            No revenue attributed to this role
          </span>
        )}
        {margin.cost ? <span>Cost {money(margin.cost)}</span> : null}
        {margin.marginPercent != null ? (
          <span>Margin {formatPercent(margin.marginPercent)}</span>
        ) : null}
        {costBasisNote ? (
          <span className="text-background/70">{costBasisNote}</span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** Where a role's cost figure came from, spelled out so an estimate can't pass as a fact. */
const COST_BASIS_LABEL: Record<RoleCostBasis, string> = {
  PERSON: "Cost from this person's compensation",
  ROLE_AVERAGE: "Open role — cost is the company average for this discipline",
  UNKNOWN: "No compensation on record, so no cost is included",
  HIDDEN: "",
};

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
        <span>
          {formatMoney(row.billRate, BILL_RATE_CURRENCY, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 2,
          })}
          /hr{row.offStandardRate ? " (off standard rate)" : ""}
        </span>
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
