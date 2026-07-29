import {
  type Currency,
  formatAmount,
  formatMoney,
} from "@/lib/format/currency";
import {
  COMP_UNIT_FRACTION_DIGITS,
  COMP_UNIT_SUFFIX,
  type CompUnit,
  roundForUnit,
} from "@/lib/performance/compensation-unit";

/**
 * Display helpers for the plan editor's money columns. Signed, tabular, and
 * null-safe — a missing figure is the caller's `EmptyCell`, never "NaN" or "0".
 *
 * Every one takes the row's {@link CompUnit}, because precision is a property of the
 * unit: cents on a salary are noise, but a $72.50/hr rate rendered as "$73/hr" is
 * simply a different number.
 *
 * All of them round to display precision BEFORE deciding on a sign, so a difference
 * that shows as zero is never given one. Cross-currency FX leaves float dust, and
 * `−CA$0` or `+0.0%` reads as a real movement that hasn't actually happened. Pair
 * the formatters with {@link displayedAmount} / {@link displayedPercent} where the
 * tone also depends on the value, so colour and text can't disagree.
 */

/** Money in a comp unit, e.g. `CA$150,000` / `CA$72.12/hr`. */
export function formatUnitMoney(
  amount: number,
  currency: Currency,
  unit: CompUnit,
): string {
  const digits = COMP_UNIT_FRACTION_DIGITS[unit];
  return `${formatMoney(amount, currency, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}${COMP_UNIT_SUFFIX[unit]}`;
}

/** An amount as it will be shown — the shared basis for its text and its tone. */
export function displayedAmount(
  amount: number | null,
  unit: CompUnit,
): number | null {
  return amount == null ? null : roundForUnit(amount, unit);
}

/** Percentages show to one decimal, i.e. to 0.001 as a fraction. */
export function displayedPercent(percent: number | null): number | null {
  return percent == null ? null : Math.round(percent * 1000) / 1000;
}

/**
 * A signed money delta, e.g. `+CA$8,000` / `−CA$2.50/hr`. No sign at zero — "no
 * change" is not a direction.
 */
export function formatChangeAmount(
  amount: number,
  currency: Currency,
  unit: CompUnit,
): string {
  const shown = roundForUnit(amount, unit);
  if (shown === 0) return formatUnitMoney(0, currency, unit);
  const sign = shown < 0 ? "−" : "+";
  return `${sign}${formatUnitMoney(Math.abs(shown), currency, unit)}`;
}

/** A signed percentage from a fraction, e.g. `0.062` → `+6.2%`; zero → `0.0%`. */
export function formatChangePercent(percent: number | null): string {
  if (percent == null) return "—";
  const shown = Math.round(percent * 1000) / 1000;
  const magnitude = formatAmount(Math.abs(shown) * 100, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  if (shown === 0) return `${magnitude}%`;
  return `${shown < 0 ? "−" : "+"}${magnitude}%`;
}

/**
 * Tone for a change cell. Only losses get colour: the design language is
 * monochrome with indigo reserved for primary actions, and there is no "success"
 * token to press into service for a raise.
 *
 * Feed it a value already rounded for display, or a row can show `CA$0` in red.
 *
 * Deliberately NOT used by the gap columns. A negative gap means the proposal sits
 * above the level's target, which is a fact to notice rather than a problem to flag
 * — painting it the same red as a pay cut would editorialize.
 */
export function changeTone(value: number | null): string {
  if (value == null || value === 0) return "text-muted-foreground";
  return value < 0 ? "text-destructive" : "";
}
