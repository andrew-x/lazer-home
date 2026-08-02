import { describe, expect, test } from "bun:test";
import { currentMonthStart } from "@/lib/timesheets/timesheet-week";
import {
  currentMonthRange,
  MAX_RANGE_DAYS,
  parseUtilizationRange,
} from "./utilization-range";

describe("currentMonthRange", () => {
  test("spans the whole current calendar month", () => {
    const range = currentMonthRange();
    expect(range.start).toBe(currentMonthStart());
    expect(range.end >= range.start).toBe(true);
    // The day after the end must be the first of the next month.
    expect(range.end.slice(8)).not.toBe("01");
  });
});

describe("parseUtilizationRange", () => {
  test("honours a valid window", () => {
    expect(parseUtilizationRange("2026-06-01", "2026-06-30")).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    });
  });

  test("falls back to the current month when either end is missing or malformed", () => {
    const fallback = currentMonthRange();
    expect(parseUtilizationRange(undefined, undefined)).toEqual(fallback);
    expect(parseUtilizationRange("2026-06-01", undefined)).toEqual(fallback);
    expect(parseUtilizationRange("last tuesday", "2026-06-30")).toEqual(
      fallback,
    );
    expect(parseUtilizationRange("2026-06-01", "2026-6-3")).toEqual(fallback);
  });

  test("rejects a well-formed but impossible date", () => {
    expect(parseUtilizationRange("2026-02-31", "2026-06-30")).toEqual(
      currentMonthRange(),
    );
  });

  test("reads an inverted window in the order it was meant", () => {
    expect(parseUtilizationRange("2026-06-30", "2026-06-01")).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    });
  });

  test("clamps an over-long window rather than scanning it", () => {
    const range = parseUtilizationRange("2026-01-01", "2030-01-01");
    expect(range.start).toBe("2026-01-01");
    // 366 inclusive days from 1 Jan 2026 — a 365-day year — reaches 1 Jan 2027.
    expect(range.end).toBe("2027-01-01");
  });

  test("takes the first value when a param repeats", () => {
    expect(
      parseUtilizationRange(["2026-06-01", "2026-07-01"], "2026-06-30"),
    ).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });

  test("MAX_RANGE_DAYS covers a full leap year", () => {
    expect(MAX_RANGE_DAYS).toBeGreaterThanOrEqual(366);
  });
});
