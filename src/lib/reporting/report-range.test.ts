import { describe, expect, test } from "bun:test";
import {
  MAX_RANGE_DAYS,
  matchingPreset,
  parseReportRange,
  presetRange,
  RANGE_PRESETS,
  shiftRange,
} from "./report-range";

/** A Wednesday in the middle of Q3 2026, so every preset has room either side. */
const TODAY = "2026-08-05";

describe("presetRange", () => {
  test("an in-progress period runs to today, not to its last calendar day", () => {
    expect(presetRange("thisMonth", TODAY)).toEqual({
      start: "2026-08-01",
      end: TODAY,
    });
    expect(presetRange("thisQuarter", TODAY)).toEqual({
      start: "2026-07-01",
      end: TODAY,
    });
    expect(presetRange("thisYear", TODAY)).toEqual({
      start: "2026-01-01",
      end: TODAY,
    });
  });

  test("last month is the whole month, because it is already complete", () => {
    expect(presetRange("lastMonth", TODAY)).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  test("last month handles the January boundary and a short February", () => {
    expect(presetRange("lastMonth", "2026-01-15")).toEqual({
      start: "2025-12-01",
      end: "2025-12-31",
    });
    expect(presetRange("lastMonth", "2026-03-10")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  test("the quarter start is the first month of the calendar quarter", () => {
    expect(presetRange("thisQuarter", "2026-01-20").start).toBe("2026-01-01");
    expect(presetRange("thisQuarter", "2026-05-20").start).toBe("2026-04-01");
    expect(presetRange("thisQuarter", "2026-09-30").start).toBe("2026-07-01");
    expect(presetRange("thisQuarter", "2026-12-31").start).toBe("2026-10-01");
  });

  test("the first day of a period is a one-day window, not an inverted one", () => {
    expect(presetRange("thisMonth", "2026-08-01")).toEqual({
      start: "2026-08-01",
      end: "2026-08-01",
    });
  });

  test("every preset fits inside the scan cap, even on 31 December", () => {
    for (const preset of RANGE_PRESETS) {
      const range = presetRange(preset, "2028-12-31"); // a leap year
      expect(parseReportRange(range.start, range.end)).toEqual(range);
    }
  });
});

describe("matchingPreset", () => {
  test("recognises a window a preset produced", () => {
    for (const preset of RANGE_PRESETS) {
      expect(matchingPreset(presetRange(preset, TODAY), TODAY)).toBe(preset);
    }
  });

  test("a hand-picked window matches nothing rather than the nearest preset", () => {
    // The current month, but one day short of today.
    expect(
      matchingPreset({ start: "2026-08-01", end: "2026-08-04" }, TODAY),
    ).toBeNull();
  });
});

describe("shiftRange", () => {
  test("a month-to-date window steps to the whole previous month, not back three days", () => {
    // The regression this guards: on the 5th, the default window is 5 days long,
    // and sliding it by its own length lands on a sliver of the month before.
    const thisMonth = presetRange("thisMonth", TODAY);
    expect(shiftRange(thisMonth, -1, TODAY)).toEqual({
      start: "2026-07-01",
      end: "2026-07-31",
    });
  });

  test("stepping back and forward again returns to where it started", () => {
    for (const preset of RANGE_PRESETS) {
      const start = presetRange(preset, TODAY);
      const back = shiftRange(start, -1, TODAY);
      expect(shiftRange(back, 1, TODAY)).toEqual(start);
    }
  });

  test("a step that lands on the current period stops at today", () => {
    expect(shiftRange(presetRange("lastMonth", TODAY), 1, TODAY)).toEqual({
      start: "2026-08-01",
      end: TODAY,
    });
  });

  test("a step wholly into the future shows the full period", () => {
    // Forward from August lands on September, which hasn't started: showing it in
    // full is how you read the plan ahead.
    const next = shiftRange(presetRange("thisMonth", TODAY), 1, TODAY);
    expect(next).toEqual({ start: "2026-09-01", end: "2026-09-30" });
  });

  test("quarters and years step by their own unit", () => {
    expect(shiftRange(presetRange("thisQuarter", TODAY), -1, TODAY)).toEqual({
      start: "2026-04-01",
      end: "2026-06-30",
    });
    expect(shiftRange(presetRange("thisYear", TODAY), -1, TODAY)).toEqual({
      start: "2025-01-01",
      end: "2025-12-31",
    });
  });

  test("a hand-picked window still slides by its own length", () => {
    const window = { start: "2026-03-10", end: "2026-03-19" }; // 10 days
    expect(shiftRange(window, -1, TODAY)).toEqual({
      start: "2026-02-28",
      end: "2026-03-09",
    });
    expect(shiftRange(window, 1, TODAY)).toEqual({
      start: "2026-03-20",
      end: "2026-03-29",
    });
  });

  test("every stepped window stays inside the scan cap", () => {
    for (const preset of RANGE_PRESETS) {
      for (const direction of [-1, 1] as const) {
        const range = shiftRange(presetRange(preset, TODAY), direction, TODAY);
        expect(parseReportRange(range.start, range.end)).toEqual(range);
      }
    }
  });
});

describe("parseReportRange", () => {
  test("honours a valid window", () => {
    expect(parseReportRange("2026-06-01", "2026-06-30")).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    });
  });

  test("falls back to the month to date when either end is missing or malformed", () => {
    const fallback = presetRange("thisMonth", TODAY);
    expect(parseReportRange(undefined, undefined, TODAY)).toEqual(fallback);
    expect(parseReportRange("2026-06-01", undefined, TODAY)).toEqual(fallback);
    expect(parseReportRange("last tuesday", "2026-06-30", TODAY)).toEqual(
      fallback,
    );
    expect(parseReportRange("2026-06-01", "2026-6-3", TODAY)).toEqual(fallback);
  });

  test("rejects a well-formed but impossible date", () => {
    expect(parseReportRange("2026-02-31", "2026-06-30", TODAY)).toEqual(
      presetRange("thisMonth", TODAY),
    );
  });

  test("reads an inverted window in the order it was meant", () => {
    expect(parseReportRange("2026-06-30", "2026-06-01")).toEqual({
      start: "2026-06-01",
      end: "2026-06-30",
    });
  });

  test("clamps an over-long window rather than scanning it", () => {
    const range = parseReportRange("2026-01-01", "2030-01-01");
    expect(range.start).toBe("2026-01-01");
    // 366 inclusive days from 1 Jan 2026 — a 365-day year — reaches 1 Jan 2027.
    expect(range.end).toBe("2027-01-01");
  });

  test("takes the first value when a param repeats", () => {
    expect(
      parseReportRange(["2026-06-01", "2026-07-01"], "2026-06-30"),
    ).toEqual({ start: "2026-06-01", end: "2026-06-30" });
  });

  // A report whose read is cheaper than the per-person day scan raises the cap
  // (the finance report allows three years). Both the raised cap and the default
  // are asserted together, because the bug worth catching is a `maxDays` argument
  // that is accepted and then ignored — which would look identical to the default.
  test("honours a caller-supplied maxDays, and still defaults without one", () => {
    const wide = parseReportRange("2026-01-01", "2030-01-01", TODAY, 1096);
    expect(wide.end).toBe("2028-12-31");
    expect(parseReportRange("2026-01-01", "2030-01-01", TODAY).end).toBe(
      "2027-01-01",
    );
  });

  test("MAX_RANGE_DAYS covers a full leap year", () => {
    expect(MAX_RANGE_DAYS).toBeGreaterThanOrEqual(366);
  });
});
