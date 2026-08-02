import { describe, expect, test } from "bun:test";
import { type PtoYearSpan, summarizePtoYear } from "@/lib/staff/pto-year";

const TODAY = "2026-08-05"; // a Wednesday
const YEAR = 2026;

function span(overrides: Partial<PtoYearSpan> = {}): PtoYearSpan {
  return {
    startDate: "2026-03-02",
    endDate: "2026-03-06",
    type: "VACATION",
    isPending: false,
    ...overrides,
  };
}

describe("summarizePtoYear", () => {
  test("approved leave in the past counts as taken", () => {
    const summary = summarizePtoYear([span()], YEAR, TODAY);
    expect(summary).toMatchObject({
      takenDays: 5,
      bookedDays: 0,
      pendingDays: 0,
    });
  });

  test("approved leave still ahead counts as booked, not taken", () => {
    const summary = summarizePtoYear(
      [span({ startDate: "2026-11-02", endDate: "2026-11-06" })],
      YEAR,
      TODAY,
    );
    expect(summary).toMatchObject({ takenDays: 0, bookedDays: 5 });
  });

  test("a span straddling today is split, with today itself counted as taken", () => {
    // Mon 3 – Fri 7 Aug, today is Wed 5: Mon–Wed taken, Thu–Fri booked.
    const summary = summarizePtoYear(
      [span({ startDate: "2026-08-03", endDate: "2026-08-07" })],
      YEAR,
      TODAY,
    );
    expect(summary).toMatchObject({ takenDays: 3, bookedDays: 2 });
  });

  test("pending leave is kept separate and never counted as taken or booked", () => {
    const summary = summarizePtoYear([span({ isPending: true })], YEAR, TODAY);
    expect(summary).toMatchObject({
      takenDays: 0,
      bookedDays: 0,
      pendingDays: 5,
    });
  });

  test("pending leave is excluded from the per-type breakdown", () => {
    const summary = summarizePtoYear([span({ isPending: true })], YEAR, TODAY);
    expect(summary.byType).toEqual([]);
  });

  test("a span crossing 1 January only counts its share of the year", () => {
    // Mon 29 Dec 2025 – Fri 2 Jan 2026: only 1 Jan (Thu) and 2 Jan (Fri) are 2026.
    const summary = summarizePtoYear(
      [span({ startDate: "2025-12-29", endDate: "2026-01-02" })],
      YEAR,
      TODAY,
    );
    expect(summary.takenDays).toBe(2);
  });

  test("a span crossing 31 December likewise stops at the year end", () => {
    // Mon 28 Dec 2026 – Fri 1 Jan 2027: 28–31 Dec are 2026 (4 weekdays).
    const summary = summarizePtoYear(
      [span({ startDate: "2026-12-28", endDate: "2027-01-01" })],
      YEAR,
      TODAY,
    );
    expect(summary.bookedDays).toBe(4);
  });

  test("leave entirely in another year is ignored", () => {
    const summary = summarizePtoYear(
      [span({ startDate: "2025-03-03", endDate: "2025-03-07" })],
      YEAR,
      TODAY,
    );
    expect(summary).toMatchObject({
      takenDays: 0,
      bookedDays: 0,
      pendingDays: 0,
    });
  });

  test("a weekend-only span counts zero working days", () => {
    const summary = summarizePtoYear(
      [span({ startDate: "2026-03-07", endDate: "2026-03-08" })],
      YEAR,
      TODAY,
    );
    expect(summary).toMatchObject({ takenDays: 0, bookedDays: 0 });
    expect(summary.byType).toEqual([]);
  });

  test("the breakdown totals approved leave per type, largest first", () => {
    const summary = summarizePtoYear(
      [
        span({
          type: "SICK_LEAVE",
          startDate: "2026-02-02",
          endDate: "2026-02-02",
        }),
        span({ type: "VACATION" }),
        span({
          type: "VACATION",
          startDate: "2026-11-02",
          endDate: "2026-11-03",
        }),
      ],
      YEAR,
      TODAY,
    );
    expect(summary.byType).toEqual([
      { type: "VACATION", days: 7 },
      { type: "SICK_LEAVE", days: 1 },
    ]);
    // The breakdown spans the year; taken/booked still split at today.
    expect(summary).toMatchObject({ takenDays: 6, bookedDays: 2 });
  });

  test("summarizing a past year reads as entirely taken", () => {
    const summary = summarizePtoYear(
      [span({ startDate: "2025-03-03", endDate: "2025-03-07" })],
      2025,
      TODAY,
    );
    expect(summary).toMatchObject({ takenDays: 5, bookedDays: 0 });
  });

  test("summarizing a future year reads as entirely booked", () => {
    const summary = summarizePtoYear(
      [span({ startDate: "2027-03-01", endDate: "2027-03-05" })],
      2027,
      TODAY,
    );
    expect(summary).toMatchObject({ takenDays: 0, bookedDays: 5 });
  });

  test("no leave at all is zeros, not nulls", () => {
    expect(summarizePtoYear([], YEAR, TODAY)).toEqual({
      takenDays: 0,
      bookedDays: 0,
      pendingDays: 0,
      byType: [],
    });
  });
});
