import {
  type Currency,
  formatAmount,
  formatMoney,
} from "@/lib/format/currency";

/**
 * Display helpers for the plan editor's money columns. Signed, tabular, and
 * null-safe — a missing figure is the caller's `EmptyCell`, never "NaN" or "0".
 */

/** A signed money delta, e.g. `+CA$8,000` / `−CA$2,500`. */
export function formatChangeAmount(amount: number, currency: Currency): string {
  const sign = amount < 0 ? "−" : "+";
  return `${sign}${formatMoney(Math.abs(amount), currency, {
    maximumFractionDigits: 0,
  })}`;
}

/** A signed percentage from a fraction, e.g. `0.062` → `+6.2%`. */
export function formatChangePercent(percent: number | null): string {
  if (percent == null) return "—";
  const sign = percent < 0 ? "−" : "+";
  return `${sign}${formatAmount(Math.abs(percent) * 100, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/**
 * Tone for a change cell. Only losses get colour: the design language is
 * monochrome with indigo reserved for primary actions, and there is no "success"
 * token to press into service for a raise.
 */
export function changeTone(value: number | null): string {
  if (value == null || value === 0) return "text-muted-foreground";
  return value < 0 ? "text-destructive" : "";
}
