"use client";

import { IconChevronDown, IconChevronRight } from "@tabler/icons-react";
import { useId } from "react";
import type { CompensationPlanEditorItem } from "@/actions/performance/getCompensationPlan";
import { EmptyCell } from "@/components/empty-cell";
import { IconButton } from "@/components/icon-button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/core/utils";
import { LINE_OF_BUSINESS_LABELS } from "@/lib/crm/line-of-business";
import { type Currency, formatMoney } from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";
import {
  type DisplayCurrencyMode,
  planChange,
  resolveDisplayCurrency,
} from "@/lib/performance/compensation-plan";
import type { Subratings } from "@/lib/performance/rating-rubric";
import { EMPLOYMENT_TYPE_LABELS, ROLE_LABELS } from "@/lib/staff/staff-enums";
import {
  decodeLevelValue,
  formatLevel,
  RATING_LEVELS,
  UNRATED_SELECT_VALUE,
} from "@/lib/staff/staff-rating";
import { PLAN_COLUMN_COUNT } from "./plan-columns";
import { PlanExpandedPanel } from "./plan-expanded-panel";
import {
  changeTone,
  formatChangeAmount,
  formatChangePercent,
} from "./plan-format";
import { PlannedCompField } from "./planned-comp-field";
import type { PlanField, PlanRowDraft } from "./use-plan-autosave";
import { parsePlannedAmount } from "./use-plan-autosave";

export function PlanRow({
  item,
  draft,
  displayMode,
  usdRates,
  readOnly,
  expanded,
  onToggleExpanded,
  onFieldChange,
  onFieldCommit,
}: {
  item: CompensationPlanEditorItem;
  draft: PlanRowDraft;
  displayMode: DisplayCurrencyMode;
  usdRates: Record<Currency, number>;
  readOnly: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onFieldChange: (field: PlanField, patch: Partial<PlanRowDraft>) => void;
  onFieldCommit: (field: PlanField) => void;
}) {
  const panelId = useId();

  // The row's own currency under "Default", the forced one otherwise. Falls back
  // to the planned currency so a person with no employment row still renders.
  const target = resolveDisplayCurrency(
    displayMode,
    item.current.currency ?? draft.plannedCurrency,
  );

  const plannedAmount = parsePlannedAmount(draft.plannedAmount);
  const change = planChange({
    currentAmount: item.current.amount,
    currentCurrency: item.current.currency,
    plannedAmount,
    plannedCurrency: draft.plannedCurrency,
    displayCurrency: target,
    usdRates,
  });

  const hourly = item.employmentType === "HOURLY";
  const suffix = hourly ? "/hr" : "";

  // The muted echo under the planned input, shown only when the number the
  // person typed isn't already in the currency the row is displayed in.
  const plannedEcho =
    plannedAmount != null &&
    draft.plannedCurrency &&
    target &&
    draft.plannedCurrency !== target
      ? convert(plannedAmount, draft.plannedCurrency, target, usdRates)
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
            <span className="font-medium">{item.name}</span>
            <span className="text-xs text-muted-foreground">
              {describe(item)}
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

        <TableCell className="tabular-nums whitespace-nowrap">
          {change.current != null && target ? (
            <>
              {formatMoney(change.current, target, {
                maximumFractionDigits: 0,
              })}
              {suffix}
            </>
          ) : (
            <EmptyCell />
          )}
        </TableCell>

        <TableCell>
          {readOnly ? (
            <span className="tabular-nums whitespace-nowrap">
              {plannedAmount != null && draft.plannedCurrency ? (
                <>
                  {formatMoney(plannedAmount, draft.plannedCurrency, {
                    maximumFractionDigits: 0,
                  })}
                  {suffix}
                </>
              ) : (
                <EmptyCell />
              )}
            </span>
          ) : (
            <PlannedCompField
              label={`Planned compensation for ${item.name}`}
              amount={draft.plannedAmount}
              currency={draft.plannedCurrency}
              converted={plannedEcho}
              displayCurrency={target}
              hourly={hourly}
              onAmountChange={(next) =>
                onFieldChange("planned", { plannedAmount: next })
              }
              onCurrencyChange={(next) =>
                onFieldChange("planned", { plannedCurrency: next })
              }
              onCommit={() => onFieldCommit("planned")}
            />
          )}
        </TableCell>

        <TableCell
          className={cn(
            "tabular-nums whitespace-nowrap",
            changeTone(change.changeAmount),
          )}
        >
          {change.changeAmount != null && target ? (
            formatChangeAmount(change.changeAmount, target)
          ) : (
            <EmptyCell />
          )}
        </TableCell>

        <TableCell
          className={cn(
            "tabular-nums whitespace-nowrap",
            changeTone(change.changePercent),
          )}
        >
          {change.changePercent != null ? (
            formatChangePercent(change.changePercent)
          ) : (
            <EmptyCell />
          )}
        </TableCell>

        <CheckCell
          label={`Rating done for ${item.name}`}
          checked={draft.ratingDone}
          disabled={readOnly}
          onChange={(next) => onFieldChange("ratingDone", { ratingDone: next })}
        />
        <CheckCell
          label={`Meeting done for ${item.name}`}
          checked={draft.meetingDone}
          disabled={readOnly}
          onChange={(next) =>
            onFieldChange("meetingDone", { meetingDone: next })
          }
        />
        <CheckCell
          label={`Complete for ${item.name}`}
          checked={draft.isComplete}
          disabled={readOnly}
          onChange={(next) => onFieldChange("isComplete", { isComplete: next })}
        />

        <TableCell>
          {/* Only meaningful once committed: the plan is then a standing
              instruction, and this says whether Rippling has caught up. */}
          {readOnly ? (
            <AppliedBadge
              item={item}
              plannedAmount={plannedAmount}
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
              displayCurrency={target}
              readOnly={readOnly}
              previousChange={planChange({
                currentAmount: item.previous.amount,
                currentCurrency: item.previous.currency,
                plannedAmount: item.current.amount,
                plannedCurrency: item.current.currency,
                displayCurrency: target,
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

function CheckCell({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <TableCell>
      <Checkbox
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
    </TableCell>
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

function describe(item: CompensationPlanEditorItem): string {
  return [
    item.lineOfBusiness ? LINE_OF_BUSINESS_LABELS[item.lineOfBusiness] : null,
    item.role ? ROLE_LABELS[item.role] : null,
    item.employmentType ? EMPLOYMENT_TYPE_LABELS[item.employmentType] : null,
    item.location,
  ]
    .filter(Boolean)
    .join(" · ");
}
