import { describe, expect, test } from "bun:test";
import { unsubmittedWeekAlerts } from "./timesheet-alerts";

// Week of Mon 2026-07-20; the week before it starts Mon 2026-07-13.
const THIS_WEEK = "2026-07-20";
const LAST_WEEK = "2026-07-13";
const WEDNESDAY = "2026-07-22";
const THURSDAY = "2026-07-23";
const SUNDAY = "2026-07-26";

const submitted = (weekStartDate: string) =>
  ({ weekStartDate, status: "submitted", started: true }) as const;
const draft = (weekStartDate: string) =>
  ({ weekStartDate, status: "draft", started: true }) as const;
const notStarted = (weekStartDate: string) =>
  ({ weekStartDate, status: "draft", started: false }) as const;

describe("unsubmittedWeekAlerts", () => {
  test("flags last week as overdue while it's still a draft", () => {
    expect(
      unsubmittedWeekAlerts(
        [draft(LAST_WEEK), submitted(THIS_WEEK)],
        WEDNESDAY,
      ),
    ).toEqual([{ weekStartDate: LAST_WEEK, tone: "overdue" }]);
  });

  test("treats a never-started week as unsubmitted", () => {
    expect(
      unsubmittedWeekAlerts(
        [notStarted(LAST_WEEK), submitted(THIS_WEEK)],
        WEDNESDAY,
      ),
    ).toEqual([{ weekStartDate: LAST_WEEK, tone: "overdue" }]);
  });

  test("treats a week missing from the list as unsubmitted", () => {
    expect(unsubmittedWeekAlerts([], WEDNESDAY)).toEqual([
      { weekStartDate: LAST_WEEK, tone: "overdue" },
    ]);
  });

  test("says nothing when both weeks are submitted", () => {
    expect(
      unsubmittedWeekAlerts(
        [submitted(LAST_WEEK), submitted(THIS_WEEK)],
        THURSDAY,
      ),
    ).toEqual([]);
  });

  test("stays quiet about the current week before Thursday", () => {
    expect(
      unsubmittedWeekAlerts(
        [submitted(LAST_WEEK), draft(THIS_WEEK)],
        WEDNESDAY,
      ),
    ).toEqual([]);
  });

  test("reminds about the current week from Thursday on", () => {
    expect(
      unsubmittedWeekAlerts([submitted(LAST_WEEK), draft(THIS_WEEK)], THURSDAY),
    ).toEqual([{ weekStartDate: THIS_WEEK, tone: "reminder" }]);
    expect(
      unsubmittedWeekAlerts([submitted(LAST_WEEK), draft(THIS_WEEK)], SUNDAY),
    ).toEqual([{ weekStartDate: THIS_WEEK, tone: "reminder" }]);
  });

  test("reports the overdue week before the current-week reminder", () => {
    expect(
      unsubmittedWeekAlerts([draft(LAST_WEEK), draft(THIS_WEEK)], THURSDAY),
    ).toEqual([
      { weekStartDate: LAST_WEEK, tone: "overdue" },
      { weekStartDate: THIS_WEEK, tone: "reminder" },
    ]);
  });

  test("normalizes any day of the week to its Monday", () => {
    expect(unsubmittedWeekAlerts([draft(LAST_WEEK)], SUNDAY)[0]).toEqual({
      weekStartDate: LAST_WEEK,
      tone: "overdue",
    });
  });

  test("ignores weeks outside the ±1 window", () => {
    expect(
      unsubmittedWeekAlerts(
        [draft("2026-07-06"), submitted(LAST_WEEK), submitted(THIS_WEEK)],
        THURSDAY,
      ),
    ).toEqual([]);
  });
});
