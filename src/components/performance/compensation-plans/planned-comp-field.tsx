"use client";

import { IconArrowsExchange } from "@tabler/icons-react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCY, type Currency, formatMoney } from "@/lib/format/currency";
import {
  type CompUnit,
  otherCompUnit,
  stepForUnit,
} from "@/lib/performance/compensation-unit";
import { formatUnitMoney } from "./plan-format";

/**
 * The raises a review round actually hands out. `+0%` earns its place: "reviewed,
 * deliberately no change" is a real decision the plan exists to record, and without
 * a button it means retyping the salary exactly.
 */
export const QUICK_RAISES = [0, 0.02, 0.03, 0.04, 0.05] as const;

/**
 * The planned-compensation cell: an amount, its currency, and a unit.
 *
 * The amount is never re-denominated by the display-**currency** toggle — it is an
 * input, and converting it would rewrite the number under the person typing and
 * round-trip it through FX on every keystroke. The conversion shows instead as a
 * muted echo beneath.
 *
 * The display-**unit** toggle does restate it, because that is the point of the
 * control — but losslessly: the text is re-derived from the untouched canonical
 * value held in the draft, so toggling back returns the identical figure and saves
 * nothing. See `use-plan-autosave.ts`.
 */
export function PlannedCompField({
  text,
  name,
  currency,
  converted,
  displayCurrency,
  unit,
  quickPickable,
  disabled,
  onTextChange,
  onCurrencyChange,
  onUnitChange,
  onQuickRaise,
  onCommit,
  label,
}: {
  /** The editing buffer, expressed in `unit`. */
  text: string;
  name: string;
  currency: Currency | null;
  /** The amount restated in `displayCurrency`, or null when no echo is needed. */
  converted: number | null;
  displayCurrency: Currency | null;
  unit: CompUnit;
  /** False when there is no current figure to take a percentage of. */
  quickPickable: boolean;
  disabled?: boolean;
  onTextChange: (next: string) => void;
  onCurrencyChange: (next: Currency) => void;
  onUnitChange: (next: CompUnit) => void;
  onQuickRaise: (percent: number) => void;
  onCommit: () => void;
  label: string;
}) {
  const nextUnit = otherCompUnit(unit);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={stepForUnit(unit)}
          aria-label={label}
          className="w-32 tabular-nums"
          value={text}
          disabled={disabled}
          onChange={(event) => onTextChange(event.target.value)}
          onBlur={onCommit}
        />
        <Select
          value={currency ?? ""}
          disabled={disabled}
          onValueChange={(next) => {
            if (next) onCurrencyChange(next as Currency);
          }}
        >
          <SelectTrigger
            size="sm"
            aria-label={`${label} currency`}
            className="w-20"
          >
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {CURRENCY.map((code) => (
              <SelectItem key={code} value={code}>
                {code}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <IconButton
          size="icon"
          className="size-6"
          label={
            nextUnit === "HOURLY"
              ? `Enter ${name}'s planned pay as an hourly rate`
              : `Enter ${name}'s planned pay as an annual figure`
          }
          onClick={() => onUnitChange(nextUnit)}
        >
          <IconArrowsExchange />
        </IconButton>
      </div>

      {/* Quick picks and the FX echo share a line, so the cell stays two rows tall
          however many affordances it grows. */}
      <div className="flex items-center gap-1">
        {QUICK_RAISES.map((percent) => (
          <Button
            key={percent}
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled || !quickPickable}
            className="h-6 px-1.5 text-xs tabular-nums text-muted-foreground hover:text-foreground"
            onClick={() => onQuickRaise(percent)}
          >
            {`+${Math.round(percent * 100)}%`}
          </Button>
        ))}
        {converted != null && displayCurrency ? (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            ≈ {formatUnitMoney(converted, displayCurrency, unit)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Bonuses land in round numbers, so the spinner moves in useful increments. */
const BONUS_STEP = 500;

/**
 * The discretionary-bonus cell: one amount, and nothing else.
 *
 * No currency select and no unit toggle, deliberately. The row's currency — the one
 * {@link PlannedCompField} owns — governs both proposed figures, so a second picker
 * would let a row hold two currencies the schema has no room for. And a lump sum has
 * no unit to toggle: unlike the planned figure it is the same number whether the row
 * is showing annual or hourly pay, so the FX echo below is stated with
 * `formatMoney`, never `formatUnitMoney`.
 */
export function BonusField({
  text,
  currency,
  converted,
  displayCurrency,
  disabled,
  onTextChange,
  onCommit,
  label,
}: {
  text: string;
  /** The row's compensation currency — display only; set via the planned cell. */
  currency: Currency | null;
  /** The bonus restated in `displayCurrency`, or null when no echo is needed. */
  converted: number | null;
  displayCurrency: Currency | null;
  disabled?: boolean;
  onTextChange: (next: string) => void;
  onCommit: () => void;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          step={BONUS_STEP}
          aria-label={label}
          className="w-28 tabular-nums"
          value={text}
          disabled={disabled}
          onChange={(event) => onTextChange(event.target.value)}
          onBlur={onCommit}
        />
        {/* The currency as text rather than a control, so it is unambiguous which
            currency the figure is in without implying it can be changed here. */}
        <span className="text-xs text-muted-foreground">{currency ?? "—"}</span>
      </div>
      {converted != null && displayCurrency ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          ≈{" "}
          {formatMoney(converted, displayCurrency, {
            maximumFractionDigits: 0,
          })}
        </span>
      ) : null}
    </div>
  );
}
