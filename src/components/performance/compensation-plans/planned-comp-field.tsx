"use client";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CURRENCY, type Currency, formatMoney } from "@/lib/format/currency";

/**
 * The planned-compensation cell: an amount plus its own currency.
 *
 * The amount is the ONE money column never re-denominated by the display-currency
 * toggle — it is an input, and converting it would rewrite the number under the
 * person typing and round-trip it through FX on every keystroke. The conversion
 * shows instead as a muted echo beneath, whenever the planned currency differs
 * from what the row is being displayed in.
 */
export function PlannedCompField({
  amount,
  currency,
  converted,
  displayCurrency,
  hourly,
  disabled,
  onAmountChange,
  onCurrencyChange,
  onCommit,
  label,
}: {
  amount: string;
  currency: Currency | null;
  /** The amount restated in `displayCurrency`, or null when no echo is needed. */
  converted: number | null;
  displayCurrency: Currency | null;
  hourly: boolean;
  disabled?: boolean;
  onAmountChange: (next: string) => void;
  onCurrencyChange: (next: Currency) => void;
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
          step={hourly ? 0.5 : 1000}
          aria-label={label}
          className="w-32 tabular-nums"
          value={amount}
          disabled={disabled}
          onChange={(event) => onAmountChange(event.target.value)}
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
      </div>
      {converted != null && displayCurrency ? (
        <span className="text-xs text-muted-foreground tabular-nums">
          ≈{" "}
          {formatMoney(converted, displayCurrency, {
            maximumFractionDigits: 0,
          })}
          {hourly ? "/hr" : ""}
        </span>
      ) : null}
    </div>
  );
}
