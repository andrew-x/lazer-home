/**
 * Display formatters for the utilization report. A pure, client-importable module
 * kept apart from `utilization-report.ts` so the math stays free of presentation.
 *
 * The em dash is load-bearing: every formatter renders `null` as "—", and in this
 * report `null` means "the viewer may not read this" or "there is nothing to
 * average", never zero. A figure that is genuinely zero renders as "0".
 */

import { formatPercent } from "@/lib/format/format";

/** Whole hours with thousands separators, e.g. `1234.5` → "1,235 h". */
export function formatHours(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value).toLocaleString("en-US")} h`;
}

/** A signed hour delta, e.g. `-12` → "−12 h", `0` → "0 h". Minus is U+2212. */
export function formatHoursDelta(value: number | null): string {
  if (value == null) return "—";
  const rounded = Math.round(value);
  if (rounded === 0) return "0 h";
  const sign = rounded > 0 ? "+" : "−";
  return `${sign}${Math.abs(rounded).toLocaleString("en-US")} h`;
}

/** Whole days, e.g. `12` → "12 days" (and "1 day"). */
export function formatDays(value: number | null): string {
  if (value == null) return "—";
  const rounded = Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("en-US")} ${rounded === 1 ? "day" : "days"}`;
}

/** Weeks to one decimal, e.g. `2.35` → "2.4 wks". */
export function formatWeeks(value: number | null): string {
  return value == null ? "—" : `${value.toFixed(1)} wks`;
}

/** A plain count; `null` → "—". */
export function formatCount(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("en-US");
}

/** A ratio to one decimal, e.g. `1.85` → "1.9". */
export function formatRatio(value: number | null): string {
  return value == null ? "—" : value.toFixed(1);
}

/** A 0–1 fraction as a percentage; `null` → "—". Re-exported for one import. */
export { formatPercent };
