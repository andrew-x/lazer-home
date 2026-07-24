import { describe, expect, test } from "bun:test";
import {
  addDays,
  addMonths,
  eachDay,
  eachMonth,
  getMonthStart,
} from "./timesheet-week";

describe("addDays", () => {
  test("crosses a month boundary", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
  });

  test("goes backwards", () => {
    expect(addDays("2026-08-01", -1)).toBe("2026-07-31");
  });
});

describe("getMonthStart", () => {
  test("normalizes any day to the first of its month", () => {
    expect(getMonthStart("2026-07-18")).toBe("2026-07-01");
    expect(getMonthStart("2026-07-01")).toBe("2026-07-01");
  });
});

describe("addMonths", () => {
  test("does not overflow from a long month into the next", () => {
    // Naively adding a month to a Jan 31 date rolls into March; anchoring to
    // the first of the month first keeps it on the intended month.
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-01");
  });

  test("crosses the year boundary in both directions", () => {
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
  });
});

describe("eachDay", () => {
  test("is inclusive of both ends", () => {
    expect(eachDay("2026-07-06", "2026-07-08")).toEqual([
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ]);
  });

  test("returns [] when end precedes start", () => {
    expect(eachDay("2026-07-08", "2026-07-06")).toEqual([]);
  });
});

describe("eachMonth", () => {
  test("normalizes to month-starts and is inclusive, across a year boundary", () => {
    expect(eachMonth("2026-11-15", "2027-01-03")).toEqual([
      "2026-11-01",
      "2026-12-01",
      "2027-01-01",
    ]);
  });

  test("returns [] when end precedes start", () => {
    expect(eachMonth("2026-08-01", "2026-07-01")).toEqual([]);
  });
});
