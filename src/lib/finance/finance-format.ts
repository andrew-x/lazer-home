/**
 * Display formatters for the finance report. A pure, client-importable module kept
 * apart from `finance-report.ts` so the math stays free of presentation.
 *
 * The em dash is load-bearing, as it is in `utilization-format.ts`: `null` here
 * means "there is no basis for this figure" — no billing type, no cost, nothing to
 * divide by — and never zero. A figure that is genuinely zero renders as "0".
 */

import { type Currency, formatMoney } from "@/lib/format/currency";
import { formatPercent } from "@/lib/format/format";

/**
 * An hourly rate to whole units, e.g. `250.4` → "US$250/h". Rates are a per-hour
 * price, so cents are noise at portfolio scale — and the underlying figure is a
 * weighted mean, which cents would dress up as precision it doesn't have.
 */
export function formatRate(value: number | null, currency: Currency): string {
  if (value == null) return "—";
  return `${formatMoney(value, currency, {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })}/h`;
}

/**
 * A signed money delta, e.g. `-12000` → "−US$12,000" (U+2212 minus). Used for the
 * fixed-fee comparator, where the sign carries the whole meaning: below role rates
 * is a discount, above is a premium.
 */
export function formatMoneyDelta(
  value: number | null,
  currency: Currency,
): string {
  if (value == null) return "—";
  const rounded = Math.round(value);
  const magnitude = formatMoney(Math.abs(rounded), currency, {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
  if (rounded === 0) return magnitude;
  return `${rounded > 0 ? "+" : "−"}${magnitude}`;
}

/**
 * A signed percentage from a 0–1 fraction, e.g. `-0.14` → "−14%". Whole numbers:
 * this is a negotiation delta, and a tenth of a percent on it is false precision.
 */
export function formatPercentDelta(value: number | null): string {
  if (value == null) return "—";
  const rounded = Math.round(value * 100);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}%`;
}

/** Whole hours with thousands separators, e.g. `1234.5` → "1,235 h". */
export function formatHours(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value).toLocaleString("en-US")} h`;
}

/** A plain count; `null` → "—". */
export function formatCount(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

/** A 0–1 fraction as a percentage; `null` → "—". Re-exported for one import. */
export { formatPercent };
