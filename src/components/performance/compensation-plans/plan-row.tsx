"use client";

import {
  IconArrowsExchange,
  IconChevronDown,
  IconChevronRight,
} from "@tabler/icons-react";
import { useId } from "react";
import type { CompensationPlanEditorItem } from "@/actions/performance/getCompensationPlan";
import { EmptyCell } from "@/components/empty-cell";
import { IconButton } from "@/components/icon-button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/core/utils";
import { type Currency, formatMoney } from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";
import {
  COMPENSATION_PLAN_ITEM_STATUS_LABELS,
  COMPENSATION_PLAN_ITEM_STATUS_SHORT,
  COMPENSATION_PLAN_ITEM_STATUSES,
  type CompensationPlanItemStatus,
  planChange,
  raisedFromCurrent,
} from "@/lib/performance/compensation-plan";
import { COMP_TARGETS_REVIEWED_ON } from "@/lib/performance/compensation-targets";
import {
  type CompUnit,
  otherCompUnit,
} from "@/lib/performance/compensation-unit";
import type { Subratings } from "@/lib/performance/rating-rubric";
import { BILLABLE_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";
import {
  decodeLevelValue,
  formatLevel,
  RATING_LEVELS,
  UNRATED_SELECT_VALUE,
} from "@/lib/staff/staff-rating";
import { staffMetaLine } from "@/lib/staff/staff-summary";
import { PLAN_COLUMN_COUNT, PLAN_NUMERIC_CELL } from "./plan-columns";
import { PlanExpandedPanel } from "./plan-expanded-panel";
import {
  changeTone,
  displayedAmount,
  displayedPercent,
  formatChangeAmount,
  formatChangePercent,
  formatUnitMoney,
} from "./plan-format";
import { inRowUnit, type PlanRowView } from "./plan-row-view";
import { PlannedCompField } from "./planned-comp-field";
import type { PlanField, PlanRowDraft } from "./use-plan-autosave";

export function PlanRow({
  view,
  usdRates,
  readOnly,
  expanded,
  onToggleExpanded,
  onOpenProfile,
  onFieldChange,
  onFieldCommit,
  onPlannedText,
  onPlannedCanonical,
  onPlannedUnit,
}: {
  view: PlanRowView;
  usdRates: Record<Currency, number>;
  readOnly: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  /** Open the read-only profile drawer for this person (the name is the trigger). */
  onOpenProfile: () => void;
  onFieldChange: (field: PlanField, patch: Partial<PlanRowDraft>) => void;
  onFieldCommit: (field: PlanField) => void;
  onPlannedText: (text: string) => void;
  onPlannedCanonical: (value: number | null) => void;
  onPlannedUnit: (unit: CompUnit) => void;
}) {
  const panelId = useId();
  const { item, draft, currency, unit, change, gap } = view;

  // Rounded to display precision up front, so the tone is decided on the number
  // actually on screen. Cross-currency FX leaves dust: an unrounded −0.0000001
  // would paint a cell that reads "CA$0" destructive red.
  const changeShown = displayedAmount(
    change.changeAmount == null ? null : inRowUnit(view, change.changeAmount),
    unit,
  );
  const changePercentShown = displayedPercent(change.changePercent);

  // The muted echo under the planned input, shown only when the number the
  // person typed isn't already in the currency the row is displayed in.
  const plannedEcho =
    draft.plannedCanonical != null &&
    draft.plannedCurrency &&
    currency &&
    draft.plannedCurrency !== currency
      ? inRowUnit(
          view,
          convert(
            draft.plannedCanonical,
            draft.plannedCurrency,
            currency,
            usdRates,
          ),
        )
      : null;

  return (
    <>
      <TableRow>
        <TableCell className="w-8">
          <IconButton
            label={expanded ? "Hide details" : "Show details"}
            size="icon"
            aria-expanded={expanded}
            aria-controls={panelId}
            onClick={onToggleExpanded}
          >
            {expanded ? <IconChevronDown /> : <IconChevronRight />}
          </IconButton>
        </TableCell>

        <TableCell>
          <div className="flex min-w-0 flex-col">
            {/* Opens the profile drawer for review in place. Deliberately NOT the
                expand toggle — that stays the chevron, so one click never means
                two things. */}
            <button
              type="button"
              aria-label={`Open ${item.name}'s profile`}
              className="w-fit text-left font-medium underline-offset-4 hover:text-primary hover:underline"
              onClick={onOpenProfile}
            >
              {item.name}
            </button>
            {/* The cell is `whitespace-nowrap`, so the five-facet line needs an
                explicit width cap or it widens the whole column. */}
            <span
              className="max-w-[15rem] truncate text-xs text-muted-foreground"
              title={staffMetaLine(item)}
            >
              {staffMetaLine(item)}
            </span>
            {!item.isActive ? (
              <Badge variant="outline" className="mt-1 w-fit">
                No longer active
              </Badge>
            ) : null}
          </div>
        </TableCell>

        <TableCell>
          <Select
            value={draft.level}
            disabled={readOnly}
            onValueChange={(next) => {
              if (next) onFieldChange("level", { level: next });
            }}
          >
            <SelectTrigger size="sm" aria-label="Rating" className="w-28">
              <SelectValue>
                {(current: string | null) =>
                  !current || current === UNRATED_SELECT_VALUE
                    ? "Unrated"
                    : formatLevel(decodeLevelValue(current))
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNRATED_SELECT_VALUE}>Unrated</SelectItem>
              {RATING_LEVELS.map((level) => (
                <SelectItem key={level} value={String(level)}>
                  {formatLevel(level)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>

        <TableCell className={PLAN_NUMERIC_CELL}>
          <span className="inline-flex items-center justify-end gap-1">
            {change.current != null && currency ? (
              formatUnitMoney(inRowUnit(view, change.current), currency, unit)
            ) : (
              <EmptyCell />
            )}
            <UnitToggle name={item.name} unit={unit} onChange={onPlannedUnit} />
          </span>
        </TableCell>

        <TableCell>
          {readOnly ? (
            <span className="tabular-nums whitespace-nowrap">
              {draft.plannedCanonical != null && draft.plannedCurrency ? (
                formatUnitMoney(
                  inRowUnit(view, draft.plannedCanonical),
                  draft.plannedCurrency,
                  unit,
                )
              ) : (
                <EmptyCell />
              )}
            </span>
          ) : (
            <PlannedCompField
              label={`Planned compensation for ${item.name}`}
              name={item.name}
              text={draft.plannedText}
              currency={draft.plannedCurrency}
              converted={plannedEcho}
              displayCurrency={currency}
              unit={unit}
              quickPickable={
                item.current.amount != null && draft.plannedCurrency != null
              }
              onTextChange={onPlannedText}
              onCurrencyChange={(next) =>
                onFieldChange("planned", { plannedCurrency: next })
              }
              onUnitChange={onPlannedUnit}
              onQuickRaise={(percent) => {
                onPlannedCanonical(
                  raisedFromCurrent({
                    currentAmount: item.current.amount,
                    currentCurrency: item.current.currency,
                    plannedCurrency: draft.plannedCurrency,
                    unit: draft.canonicalUnit,
                    percent,
                    usdRates,
                  }),
                );
                onFieldCommit("planned");
              }}
              onCommit={() => onFieldCommit("planned")}
            />
          )}
        </TableCell>

        <TableCell className={cn(PLAN_NUMERIC_CELL, changeTone(changeShown))}>
          {changeShown != null && currency ? (
            formatChangeAmount(changeShown, currency, unit)
          ) : (
            <EmptyCell />
          )}
        </TableCell>

        <TableCell
          className={cn(PLAN_NUMERIC_CELL, changeTone(changePercentShown))}
        >
          {changePercentShown != null ? (
            formatChangePercent(changePercentShown)
          ) : (
            <EmptyCell />
          )}
        </TableCell>

        {/* Gap columns carry no tone — see `changeTone`'s note on why above-target
            isn't painted like a pay cut. */}
        <TableCell className={PLAN_NUMERIC_CELL}>
          {gap.gapAmount != null && currency ? (
            <GapTooltip
              view={view}
              label={formatChangeAmount(
                inRowUnit(view, gap.gapAmount),
                currency,
                unit,
              )}
            />
          ) : (
            <EmptyCell />
          )}
        </TableCell>

        <TableCell className={PLAN_NUMERIC_CELL}>
          {gap.gapPercent != null ? (
            formatChangePercent(gap.gapPercent)
          ) : (
            <EmptyCell />
          )}
        </TableCell>

        <TableCell>
          {readOnly ? (
            <Badge variant="secondary" className="whitespace-nowrap">
              {COMPENSATION_PLAN_ITEM_STATUS_LABELS[draft.status]}
            </Badge>
          ) : (
            <ToggleGroup
              variant="outline"
              spacing={0}
              size="sm"
              aria-label={`Status for ${item.name}`}
              value={[draft.status]}
              onValueChange={(values) => {
                // Single-select: ignore the empty array Base UI emits when the
                // active segment is pressed again, so a stage is always set.
                if (values.length > 0) {
                  onFieldChange("status", {
                    status: values[0] as CompensationPlanItemStatus,
                  });
                }
              }}
            >
              {COMPENSATION_PLAN_ITEM_STATUSES.map((status) => (
                <ToggleGroupItem
                  key={status}
                  value={status}
                  aria-label={COMPENSATION_PLAN_ITEM_STATUS_LABELS[status]}
                  className="text-xs"
                >
                  {COMPENSATION_PLAN_ITEM_STATUS_SHORT[status]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
        </TableCell>

        <TableCell>
          {/* Only meaningful once committed: the plan is then a standing
              instruction, and this says whether Rippling has caught up. */}
          {readOnly ? (
            <AppliedBadge
              item={item}
              plannedAmount={draft.plannedCanonical}
              plannedCurrency={draft.plannedCurrency}
              usdRates={usdRates}
            />
          ) : null}
        </TableCell>
      </TableRow>

      {expanded ? (
        <TableRow>
          <TableCell colSpan={PLAN_COLUMN_COUNT} className="p-0">
            <PlanExpandedPanel
              item={item}
              panelId={panelId}
              subratings={draft.subratings}
              evaluationNotes={draft.evaluationNotes}
              compensationNotes={draft.compensationNotes}
              displayCurrency={currency}
              unit={unit}
              canonicalUnit={view.canonicalUnit}
              readOnly={readOnly}
              previousChange={planChange({
                currentAmount: item.previous.amount,
                currentCurrency: item.previous.currency,
                plannedAmount: item.current.amount,
                plannedCurrency: item.current.currency,
                displayCurrency: currency,
                usdRates,
              })}
              onSubratingChange={(next: Subratings) =>
                onFieldChange("subratings", { subratings: next })
              }
              onNotesChange={(field, next) =>
                onFieldChange(field, { [field]: next })
              }
              onNotesCommit={(field) => onFieldCommit(field)}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}

/**
 * Flip the row between annual and hourly. Not disabled by `readOnly`: it restates
 * a number rather than changing one, which is as valid on a committed plan as the
 * display-currency toggle is.
 */
function UnitToggle({
  name,
  unit,
  onChange,
}: {
  name: string;
  unit: CompUnit;
  onChange: (unit: CompUnit) => void;
}) {
  const next = otherCompUnit(unit);
  return (
    <IconButton
      size="icon"
      className="size-6"
      label={
        next === "HOURLY"
          ? `Show ${name}'s pay as an hourly rate`
          : `Show ${name}'s pay as an annual figure`
      }
      onClick={() => onChange(next)}
    >
      <IconArrowsExchange />
    </IconButton>
  );
}

/**
 * Names the reference behind a gap. Without it the column is two unattributed
 * numbers — you can't tell which band, which level, or how stale the table is.
 */
function GapTooltip({ view, label }: { view: PlanRowView; label: string }) {
  const { item, draft, gap, unit, currency, targetLevel } = view;
  const proposed = decodeLevelValue(draft.level);

  const parts = [
    gap.target != null && currency
      ? `Target ${formatUnitMoney(inRowUnit(view, gap.target), currency, unit)}`
      : null,
    // Say so when the target came from their last saved level rather than a
    // proposed one — the number means something slightly different.
    `${formatLevel(targetLevel)}${proposed == null ? " (last rated)" : ""}`,
    item.role ? ROLE_LABELS[item.role] : null,
    item.billableType ? BILLABLE_TYPE_LABELS[item.billableType] : null,
    `reviewed ${COMP_TARGETS_REVIEWED_ON}`,
  ].filter(Boolean);

  return (
    <Tooltip>
      <TooltipTrigger render={<span>{label}</span>} />
      <TooltipContent>{parts.join(" · ")}</TooltipContent>
    </Tooltip>
  );
}

/**
 * On a committed plan, whether the proposal has actually landed in Rippling.
 *
 * Compensation is never written by this app, so a committed plan is a standing
 * instruction to someone else. This compares the proposal against live
 * compensation and says whether it has been applied — the reconciliation half of
 * keeping Rippling the system of record.
 */
function AppliedBadge({
  item,
  plannedAmount,
  plannedCurrency,
  usdRates,
}: {
  item: CompensationPlanEditorItem;
  plannedAmount: number | null;
  plannedCurrency: Currency | null;
  usdRates: Record<Currency, number>;
}) {
  if (plannedAmount == null || !plannedCurrency) return null;
  if (item.live.amount == null || !item.live.currency) return null;

  const liveInPlanned = convert(
    item.live.amount,
    item.live.currency,
    plannedCurrency,
    usdRates,
  );
  // Sub-dollar drift is rounding, not a discrepancy.
  const applied = Math.abs(liveInPlanned - plannedAmount) < 1;

  return applied ? (
    <Badge variant="outline">Applied</Badge>
  ) : (
    <Badge variant="destructive" className="whitespace-nowrap">
      Not applied ·{" "}
      {formatMoney(item.live.amount, item.live.currency, {
        maximumFractionDigits: 0,
      })}
    </Badge>
  );
}
