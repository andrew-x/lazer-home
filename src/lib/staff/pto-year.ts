/**
 * A person's leave for one calendar year, split by what has actually happened.
 * A pure, client-importable module (no `db`, no React) fed the spans `getStaffPto`
 * already returns, so the home dashboard's PTO tile costs no extra query.
 *
 * Deliberately **not** `getStaffPto`'s own `summary`, which lumps pending requests
 * in with approved ones and counts a booking six months out as time taken. "PTO
 * taken" on a point-in-time dashboard has to mean days already used:
 *
 * - **taken** — approved, and the day has passed (spans straddling today are split)
 * - **booked** — approved, still ahead of you this year
 * - **pending** — awaiting approval, wherever it falls in the year
 *
 * Every span is clamped to the year first, so leave crossing 1 January counts only
 * its share. Counts are Mon–Fri working days via `countWorkingDays` — there are no
 * half-days in the model, and no statutory-holiday calendar.
 */

import { countWorkingDays } from "@/lib/staff/pto-working-days";
import type { PtoType } from "@/lib/staff/staff-enums";

/** The subset of a leave span this module needs. */
export type PtoYearSpan = {
  startDate: string;
  endDate: string;
  type: PtoType;
  isPending: boolean;
};

export type PtoYearSummary = {
  /** Approved working days already elapsed this year. */
  takenDays: number;
  /** Approved working days still ahead this year. */
  bookedDays: number;
  /** Working days awaiting approval, anywhere in the year. */
  pendingDays: number;
  /** Approved days (taken + booked) per category, largest first. */
  byType: { type: PtoType; days: number }[];
};

/** Mon–Fri days in the overlap of `[start, end]` and `[from, to]`, or 0 if disjoint. */
function workingDaysWithin(
  start: string,
  end: string,
  from: string,
  to: string,
): number {
  const clampStart = start > from ? start : from;
  const clampEnd = end < to ? end : to;
  return clampStart <= clampEnd ? countWorkingDays(clampStart, clampEnd) : 0;
}

/**
 * Summarize `spans` for the calendar `year`, splitting approved leave at `today`.
 * `today` is injected rather than read from the clock so this stays pure and the
 * boundary cases are testable.
 */
export function summarizePtoYear(
  spans: readonly PtoYearSpan[],
  year: number,
  today: string,
): PtoYearSummary {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  // Today may sit outside the year being summarized. A past year is entirely
  // "taken", hence the clamp; a future year needs none — `today` then falls
  // before `yearStart`, so every taken-window overlap is empty and it all reads
  // as booked.
  const splitAt = today > yearEnd ? yearEnd : today;

  let takenDays = 0;
  let bookedDays = 0;
  let pendingDays = 0;
  const byType = new Map<PtoType, number>();

  for (const span of spans) {
    const inYear = workingDaysWithin(
      span.startDate,
      span.endDate,
      yearStart,
      yearEnd,
    );
    if (inYear === 0) continue;

    if (span.isPending) {
      pendingDays += inYear;
      continue;
    }

    // Today itself counts as taken — you're off now, not later.
    const taken = workingDaysWithin(
      span.startDate,
      span.endDate,
      yearStart,
      splitAt,
    );
    takenDays += taken;
    bookedDays += inYear - taken;
    byType.set(span.type, (byType.get(span.type) ?? 0) + inYear);
  }

  return {
    takenDays,
    bookedDays,
    pendingDays,
    byType: [...byType.entries()]
      .map(([type, days]) => ({ type, days }))
      .sort((a, b) => b.days - a.days || a.type.localeCompare(b.type)),
  };
}
