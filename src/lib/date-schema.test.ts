import { describe, expect, test } from "bun:test";
import { dateString, isCalendarDate } from "./date-schema";

describe("isCalendarDate", () => {
  test("accepts real calendar dates", () => {
    expect(isCalendarDate("2026-07-18")).toBe(true);
    expect(isCalendarDate("2026-01-01")).toBe(true);
    expect(isCalendarDate("2026-12-31")).toBe(true);
  });

  test("rejects an impossible day of month", () => {
    // Feb never has 30 days; a naive parse rolls this over to early March.
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("2026-04-31")).toBe(false);
  });

  test("rejects an impossible month", () => {
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-00-10")).toBe(false);
  });

  test("handles leap years — Feb 29 valid only in a leap year", () => {
    expect(isCalendarDate("2024-02-29")).toBe(true); // 2024 is a leap year
    expect(isCalendarDate("2025-02-29")).toBe(false); // 2025 is not
    expect(isCalendarDate("2100-02-29")).toBe(false); // century non-leap year
    expect(isCalendarDate("2000-02-29")).toBe(true); // divisible by 400
  });

  test("rejects anything that isn't the YYYY-MM-DD shape", () => {
    expect(isCalendarDate("2026-2-3")).toBe(false);
    expect(isCalendarDate("07/18/2026")).toBe(false);
    expect(isCalendarDate("not-a-date")).toBe(false);
    expect(isCalendarDate("")).toBe(false);
  });
});

describe("dateString schema", () => {
  test("parses a valid calendar date", () => {
    expect(dateString.safeParse("2024-02-29").success).toBe(true);
  });

  test("rejects an impossible calendar date", () => {
    const result = dateString.safeParse("2026-02-30");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Pick a valid date.");
    }
  });

  test("rejects a malformed string", () => {
    expect(dateString.safeParse("2026-13-01").success).toBe(false);
    expect(dateString.safeParse("07/18/2026").success).toBe(false);
  });
});
