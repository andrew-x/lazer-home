/**
 * Week math for timesheets. A pure, client-importable module (no `db`/drizzle):
 * the UI, the actions, and the validation all agree on what a "week" is.
 *
 * Weeks are timezone-agnostic and keyed by their **ISO Monday** as a
 * `"YYYY-MM-DD"` string — the same wall-clock convention the DB uses for
 * `date()` columns (see `.claude/rules/database.md`). We deliberately avoid a
 * date library (none is installed) and the UTC-offset drift of `new Date("...")`
 * by parsing/formatting via local Y/M/D parts, via the shared `@/lib/format/format`
 * helpers.
 */

import { formatIsoDate, parseIsoDate } from "@/lib/format/format";

/** Whole-day index since the Unix epoch, computed in UTC to sidestep DST. */
function dayNumber(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

/** The ISO Monday (as `"YYYY-MM-DD"`) of the week containing `date`. */
export function getWeekStart(date: string): string {
  const d = parseIsoDate(date);
  // getDay(): 0=Sun..6=Sat. Days elapsed since Monday = (day + 6) % 7.
  const sinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - sinceMonday);
  return formatIsoDate(d);
}

/** Shift a week-start date by `n` weeks (may be negative). */
export function addWeeks(weekStart: string, n: number): string {
  const d = parseIsoDate(weekStart);
  d.setDate(d.getDate() + n * 7);
  return formatIsoDate(d);
}

/** Shift a date by `n` days (may be negative). */
export function addDays(date: string, n: number): string {
  const d = parseIsoDate(date);
  d.setDate(d.getDate() + n);
  return formatIsoDate(d);
}

/** The first of the month (as `"YYYY-MM-01"`) containing `date`. */
export function getMonthStart(date: string): string {
  const d = parseIsoDate(date);
  d.setDate(1);
  return formatIsoDate(d);
}

/**
 * Shift a month-start date by `n` months (may be negative). Normalizes to the
 * first of the month first, so it never overflows into the next month.
 */
export function addMonths(monthStart: string, n: number): string {
  const d = parseIsoDate(monthStart);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return formatIsoDate(d);
}

/** True for a Saturday or Sunday — timesheets only capture weekday work. */
export function isWeekend(date: string): boolean {
  const day = parseIsoDate(date).getDay();
  return day === 0 || day === 6;
}

/**
 * Every ISO-Monday from the week containing `start` to the week containing
 * `end`, inclusive (both ends are normalized to their week start first). Returns
 * `[]` when `end` falls before `start`. The week-column spine for a multi-week
 * planner (a role active `start`→`end` maps onto these columns).
 */
export function eachWeek(start: string, end: string): string[] {
  const first = getWeekStart(start);
  const last = getWeekStart(end);
  const weeks: string[] = [];
  for (let w = first; w <= last; w = addWeeks(w, 1)) {
    weeks.push(w);
  }
  return weeks;
}

/**
 * Every day from `start` to `end`, inclusive. Returns `[]` when `end` falls
 * before `start`. The day-column spine for the planner's daily view (unlike
 * `eachWeek`/`eachMonth`, days aren't normalized — the range is taken as given).
 */
export function eachDay(start: string, end: string): string[] {
  const days: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    days.push(d);
  }
  return days;
}

/**
 * Every month-start (first of the month) from the month containing `start` to
 * the month containing `end`, inclusive. Returns `[]` when `end` falls before
 * `start`. The month-column spine for the planner's monthly view.
 */
export function eachMonth(start: string, end: string): string[] {
  const first = getMonthStart(start);
  const last = getMonthStart(end);
  const months: string[] = [];
  for (let m = first; m <= last; m = addMonths(m, 1)) {
    months.push(m);
  }
  return months;
}

/** The 7 day dates (Mon→Sun) of the week beginning `weekStart`. */
export function getWeekDays(weekStart: string): string[] {
  const monday = parseIsoDate(weekStart);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return formatIsoDate(d);
  });
}

/** Today as a `"YYYY-MM-DD"` wall-clock date. */
export function currentDay(): string {
  return formatIsoDate(new Date());
}

/** The ISO Monday of the current week. */
export function currentWeekStart(): string {
  return getWeekStart(currentDay());
}

/** The first of the current month. */
export function currentMonthStart(): string {
  return getMonthStart(currentDay());
}

/** Signed whole-week distance from week `a` to week `b` (both any date in-week). */
function weeksBetween(a: string, b: string): number {
  return (dayNumber(getWeekStart(b)) - dayNumber(getWeekStart(a))) / 7;
}

/**
 * Is `weekStart` inside the ±1-week window a normal user may edit/submit? True
 * for last week, this week, and next week. Anything further out requires the
 * `timesheets.edit` capability (manager/admin). See docs/domains/timesheets.md.
 */
export function isWithinEditWindow(weekStart: string): boolean {
  return Math.abs(weeksBetween(currentWeekStart(), weekStart)) <= 1;
}
