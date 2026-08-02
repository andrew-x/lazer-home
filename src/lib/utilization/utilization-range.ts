/**
 * Parsing and defaulting for the utilization report's reporting window. A pure,
 * client-importable module (no `db`, no React): the page reads the window off the
 * URL, the filter bar writes it back, and both agree on what a valid window is.
 *
 * The window is in the URL rather than in client state because it bounds the
 * server query — and because a report worth reading is worth linking to.
 */

import {
  addDays,
  addMonths,
  currentMonthStart,
} from "@/lib/timesheets/timesheet-week";
import type { UtilizationRange } from "@/lib/utilization/utilization-report";

export const RANGE_START_PARAM = "start";
export const RANGE_END_PARAM = "end";

/**
 * The widest window the report will honour. The read scans day-by-day per person,
 * so an unbounded span pasted into the URL would be an easy way to make the server
 * do a lot of work; anything longer is clamped to this from the start date.
 */
export const MAX_RANGE_DAYS = 366;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in `"YYYY-MM-DD"` form — rejects "2026-02-31". */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** First string value of a search param, mirroring how the pages read them. */
function firstValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] ?? null;
  return null;
}

/** The current calendar month — the window the report opens on. */
export function currentMonthRange(): UtilizationRange {
  const start = currentMonthStart();
  return { start, end: addDays(addMonths(start, 1), -1) };
}

/**
 * Resolve the window from raw search params, falling back to the current month.
 * Invalid, missing, inverted or over-long inputs all degrade to something sane
 * rather than erroring — a mistyped URL should still render a report.
 */
export function parseUtilizationRange(
  startParam: string | string[] | undefined,
  endParam: string | string[] | undefined,
): UtilizationRange {
  const rawStart = firstValue(startParam);
  const rawEnd = firstValue(endParam);
  if (
    rawStart == null ||
    rawEnd == null ||
    !isValidIsoDate(rawStart) ||
    !isValidIsoDate(rawEnd)
  ) {
    return currentMonthRange();
  }

  // An inverted window is a slip, not an intent — read it in the order meant.
  const start = rawStart <= rawEnd ? rawStart : rawEnd;
  const end = rawStart <= rawEnd ? rawEnd : rawStart;
  const cap = addDays(start, MAX_RANGE_DAYS - 1);

  return { start, end: end > cap ? cap : end };
}
