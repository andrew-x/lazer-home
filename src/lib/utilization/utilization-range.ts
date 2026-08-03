/**
 * Parsing, presets and defaulting for the utilization report's reporting window.
 * A pure, client-importable module (no `db`, no React): the page reads the window
 * off the URL, the filter bar writes it back, and both agree on what a valid
 * window is.
 *
 * The window is in the URL rather than in client state because it bounds the
 * server query — and because a report worth reading is worth linking to.
 */

import {
  addDays,
  addMonths,
  currentDay,
  getMonthStart,
} from "@/lib/timesheets/timesheet-week";
import type { UtilizationRange } from "@/lib/utilization/utilization-report";

export const RANGE_START_PARAM = "start";
export const RANGE_END_PARAM = "end";

/**
 * The widest window the report will honour. The read scans day-by-day per person,
 * so an unbounded span pasted into the URL would be an easy way to make the server
 * do a lot of work; anything longer is clamped to this from the start date. Every
 * preset below fits inside it, including a leap year.
 */
export const MAX_RANGE_DAYS = 366;

/** The windows the filter bar offers as one-click shortcuts, in display order. */
export const RANGE_PRESETS = [
  "thisMonth",
  "lastMonth",
  "thisQuarter",
  "thisYear",
] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_PRESET_LABELS: Record<RangePreset, string> = {
  thisMonth: "This month",
  lastMonth: "Last month",
  thisQuarter: "This quarter",
  thisYear: "This year",
};

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

/** Whole-day index since the epoch, in UTC so DST can't shift a difference. */
function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** The first day of the calendar quarter containing `day`. */
function quarterStart(day: string): string {
  const monthIndex = Number(day.slice(5, 7)) - 1;
  return addMonths(getMonthStart(day), -(monthIndex % 3));
}

/** The calendar units a window can be a whole period of, smallest first. */
const PERIOD_UNITS = ["month", "quarter", "year"] as const;

type PeriodUnit = (typeof PERIOD_UNITS)[number];

const MONTHS_PER_UNIT: Record<PeriodUnit, number> = {
  month: 1,
  quarter: 3,
  year: 12,
};

/** The first day of the calendar period of `unit` containing `day`. */
function periodStart(day: string, unit: PeriodUnit): string {
  switch (unit) {
    case "month":
      return getMonthStart(day);
    case "quarter":
      return quarterStart(day);
    case "year":
      return `${day.slice(0, 4)}-01-01`;
  }
}

/** The last day of the calendar period of `unit` beginning at `start`. */
function periodEnd(start: string, unit: PeriodUnit): string {
  if (unit === "year") return `${start.slice(0, 4)}-12-31`;
  return addDays(addMonths(start, MONTHS_PER_UNIT[unit]), -1);
}

/**
 * Which calendar period `range` *is*, if any — either a whole one, or one in
 * progress that stops at today. Read off the window's own shape rather than off
 * {@link matchingPreset}, so a window is still steppable once the reader has
 * stepped away from the preset that produced it.
 *
 * Smallest unit wins, because a period-to-date window early in January is
 * simultaneously month-, quarter- and year-to-date; month is what the filter bar
 * highlights in that case, so month is what the arrows should step.
 */
function periodUnitOf(
  range: UtilizationRange,
  today: string,
): PeriodUnit | null {
  for (const unit of PERIOD_UNITS) {
    const start = periodStart(range.start, unit);
    if (start !== range.start) continue;
    const end = periodEnd(start, unit);
    if (range.end === end) return unit;
    if (range.end === today && today >= start && today < end) return unit;
  }
  return null;
}

/**
 * Resolve a preset to a window. **Period-to-date:** an in-progress month, quarter
 * or year ends *today*, not on its last calendar day — a window running into the
 * future would count capacity nobody has had the chance to log against yet and
 * make every logged figure read as a shortfall. "Last month" is complete by
 * definition, so it is the whole month.
 */
export function presetRange(
  preset: RangePreset,
  today: string = currentDay(),
): UtilizationRange {
  switch (preset) {
    case "thisMonth":
      return { start: getMonthStart(today), end: today };
    case "lastMonth": {
      const thisMonth = getMonthStart(today);
      return {
        start: addMonths(thisMonth, -1),
        end: addDays(thisMonth, -1),
      };
    }
    case "thisQuarter":
      return { start: quarterStart(today), end: today };
    case "thisYear":
      return { start: `${today.slice(0, 4)}-01-01`, end: today };
  }
}

/**
 * Which preset — if any — the current window corresponds to, so the filter bar
 * can highlight it. A hand-picked window matches nothing, and that is a state the
 * bar shows rather than rounding to the nearest preset.
 */
export function matchingPreset(
  range: UtilizationRange,
  today: string = currentDay(),
): RangePreset | null {
  return (
    RANGE_PRESETS.find((preset) => {
      const candidate = presetRange(preset, today);
      return candidate.start === range.start && candidate.end === range.end;
    }) ?? null
  );
}

/**
 * Step the window one period back or forward.
 *
 * A window that *is* a calendar period steps by **whole periods**, not by its own
 * length: the month-to-date window the report opens on is only a few days long in
 * the first week of a month, and sliding it by three days would land on a
 * meaningless sliver of the previous month instead of on the previous month. An
 * in-progress period still stops at today, matching the presets, while a period
 * wholly behind or ahead of us is shown in full — stepping forward is how you look
 * at the plan for next month. Stepping is therefore reversible: back then forward
 * returns the window you started from.
 *
 * A hand-picked window has no calendar period to step, so it keeps sliding by its
 * own length: an arbitrary 10-day window moves 10 days.
 */
export function shiftRange(
  range: UtilizationRange,
  direction: 1 | -1,
  today: string = currentDay(),
): UtilizationRange {
  const unit = periodUnitOf(range, today);
  if (unit == null) {
    const span = dayNumber(range.end) - dayNumber(range.start) + 1;
    return {
      start: addDays(range.start, direction * span),
      end: addDays(range.end, direction * span),
    };
  }

  const start = addMonths(
    periodStart(range.start, unit),
    direction * MONTHS_PER_UNIT[unit],
  );
  const end = periodEnd(start, unit);
  return { start, end: start <= today && today < end ? today : end };
}

/**
 * Resolve the window from raw search params, falling back to the current month to
 * date. Invalid, missing, inverted or over-long inputs all degrade to something
 * sane rather than erroring — a mistyped URL should still render a report.
 */
export function parseUtilizationRange(
  startParam: string | string[] | undefined,
  endParam: string | string[] | undefined,
  today: string = currentDay(),
): UtilizationRange {
  const rawStart = firstValue(startParam);
  const rawEnd = firstValue(endParam);
  if (
    rawStart == null ||
    rawEnd == null ||
    !isValidIsoDate(rawStart) ||
    !isValidIsoDate(rawEnd)
  ) {
    return presetRange("thisMonth", today);
  }

  // An inverted window is a slip, not an intent — read it in the order meant.
  const start = rawStart <= rawEnd ? rawStart : rawEnd;
  const end = rawStart <= rawEnd ? rawEnd : rawStart;
  const cap = addDays(start, MAX_RANGE_DAYS - 1);

  return { start, end: end > cap ? cap : end };
}
