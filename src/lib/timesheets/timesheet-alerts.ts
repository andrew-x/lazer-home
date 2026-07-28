/**
 * Which weeks still need submitting, as shown by the banner at the top of the
 * timesheets pages. A pure, client-importable module (no `db`/drizzle, no React)
 * with `today` injected rather than read from the clock, so the Thursday cutoff
 * is unit-testable. See docs/domains/timesheets.md.
 */

import type { TimesheetStatus } from "@/lib/timesheets/timesheet-status";
import {
  addWeeks,
  getWeekStart,
  SUBMISSION_REMINDER_WEEKDAY,
  weekdayIndex,
} from "@/lib/timesheets/timesheet-week";

/**
 * A week that hasn't been submitted:
 * - `overdue`  — last week; it drops out of the ±1-week edit window on Monday.
 * - `reminder` — the current week, from Thursday on; due at the end of the week.
 */
export type UnsubmittedWeekAlert = {
  weekStartDate: string;
  tone: "overdue" | "reminder";
};

/** The shape the alerts need off a browse-list row. */
type WeekState = {
  weekStartDate: string;
  status: TimesheetStatus;
  /** False for a week with no timesheet row yet — unsubmitted, like a draft. */
  started: boolean;
};

function isSubmitted(weeks: WeekState[], weekStartDate: string): boolean {
  const week = weeks.find((w) => w.weekStartDate === weekStartDate);
  // A week missing from the list has nothing logged, so it isn't submitted.
  return week ? week.started && week.status === "submitted" : false;
}

/**
 * The unsubmitted weeks worth nagging about, most urgent first. Only the two
 * weeks a normal user can still act on are considered: last week (always) and
 * the current week (only from {@link SUBMISSION_REMINDER_WEEKDAY} on, so nobody
 * is told on Monday morning that they haven't submitted Monday).
 */
export function unsubmittedWeekAlerts(
  weeks: WeekState[],
  today: string,
): UnsubmittedWeekAlert[] {
  const thisWeek = getWeekStart(today);
  const lastWeek = addWeeks(thisWeek, -1);
  const alerts: UnsubmittedWeekAlert[] = [];

  if (!isSubmitted(weeks, lastWeek)) {
    alerts.push({ weekStartDate: lastWeek, tone: "overdue" });
  }
  if (
    weekdayIndex(today) >= SUBMISSION_REMINDER_WEEKDAY &&
    !isSubmitted(weeks, thisWeek)
  ) {
    alerts.push({ weekStartDate: thisWeek, tone: "reminder" });
  }

  return alerts;
}
