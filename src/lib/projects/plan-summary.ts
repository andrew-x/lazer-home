/**
 * Pure helpers for the project-plan summary tiles — the date-range and
 * delivery-manager labels shown above the planner grid. A client-importable
 * module (no `db`/drizzle, no React) so the opportunity's Project-plan tab and
 * the standalone project detail page render identical stats from one source.
 */

import { parseIsoDate } from "@/lib/format/format";

/** A date span as inclusive "YYYY-MM-DD" bounds. */
export type DateRange = { start: string; end: string };

/**
 * Overall span (min start, max end) across the given dated items, or null when
 * empty. Accepts anything carrying `startDate`/`endDate` (e.g. plan roles).
 */
export function rangeOf(
  items: { startDate: string; endDate: string }[],
): DateRange | null {
  let range: DateRange | null = null;
  for (const item of items) {
    if (!range) {
      range = { start: item.startDate, end: item.endDate };
      continue;
    }
    if (item.startDate < range.start) range.start = item.startDate;
    if (item.endDate > range.end) range.end = item.endDate;
  }
  return range;
}

/** A compact "Mon D" for an ISO date, for the summary tiles. */
function shortMonthDay(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(parseIsoDate(iso));
}

/** "Aug 3 – Dec 12" for a date range tile value. */
export function rangeLabel(range: DateRange): string {
  return `${shortMonthDay(range.start)} – ${shortMonthDay(range.end)}`;
}

/** The year (or "2026–2027") for a range tile hint. */
export function yearHint(range: DateRange): string {
  const from = range.start.slice(0, 4);
  const to = range.end.slice(0, 4);
  return from === to ? from : `${from}–${to}`;
}

/** The comma-joined delivery-manager names for the summary tile, or "—". */
export function deliveryManagerLabel(
  managers: { id: string; name: string }[],
): string {
  return managers.length ? managers.map((m) => m.name).join(", ") : "—";
}
