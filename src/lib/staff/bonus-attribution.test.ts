import { describe, expect, test } from "bun:test";
import { employmentAsOf } from "./bonus-attribution";

/**
 * Bonus attribution decides which line of business and role a payment is counted
 * under, so every case here is a silently-wrong-number risk rather than a crash:
 * pick the wrong row and the dashboard moves spend between disciplines with no
 * visible symptom.
 *
 * Rows are newest-first throughout, matching `latestEmploymentFirst` — the
 * ordering every employment read already applies.
 */

const rows = [
  { effectiveFromDate: "2026-06-01", role: "ENGINEER" },
  { effectiveFromDate: "2025-03-15", role: "DESIGNER" },
  { effectiveFromDate: "2024-01-10", role: "QA" },
] as const;

describe("employmentAsOf", () => {
  test("picks the row effective exactly on the payment date", () => {
    expect(employmentAsOf(rows, "2025-03-15")?.role).toBe("DESIGNER");
  });

  test("picks the row in force between two effective dates", () => {
    // A February 2026 bonus belongs to the DESIGNER row, not the June ENGINEER
    // one — this is the whole point of as-of attribution.
    expect(employmentAsOf(rows, "2026-02-20")?.role).toBe("DESIGNER");
  });

  test("picks the latest row for a payment after the last effective date", () => {
    expect(employmentAsOf(rows, "2026-07-30")?.role).toBe("ENGINEER");
  });

  test("falls back to the earliest row when the payment predates all history", () => {
    // A signing bonus dated before the first employment row. It must land
    // somewhere: dropping it would under-report the total silently.
    expect(employmentAsOf(rows, "2023-12-31")?.role).toBe("QA");
  });

  test("returns null when the person has no employment rows", () => {
    expect(employmentAsOf([], "2026-01-01")).toBeNull();
  });

  test("respects the caller's ordering on a same-day tie", () => {
    // Two rows share an effective date; `latestEmploymentFirst` breaks the tie by
    // createdAt, so the FIRST of the two is the current fact and must win.
    const sameDay = [
      { effectiveFromDate: "2026-01-01", role: "NEWER" },
      { effectiveFromDate: "2026-01-01", role: "OLDER" },
    ];
    expect(employmentAsOf(sameDay, "2026-03-01")?.role).toBe("NEWER");
    expect(employmentAsOf(sameDay, "2026-01-01")?.role).toBe("NEWER");
  });

  test("does not parse dates as Date objects (no timezone drift)", () => {
    // "YYYY-MM-DD" compares correctly as a string; a Date-based implementation
    // would shift these across a day boundary in a negative-offset zone.
    const boundary = [{ effectiveFromDate: "2026-01-01", role: "A" }];
    expect(employmentAsOf(boundary, "2026-01-01")?.role).toBe("A");
    expect(employmentAsOf(boundary, "2025-12-31")?.role).toBe("A");
  });
});
