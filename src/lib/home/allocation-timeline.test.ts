import { describe, expect, test } from "bun:test";
import {
  buildTimelineRows,
  layoutRow,
  pctOf,
  TIMELINE_MAX_ROWS,
  type TimelineRoleInput,
  timelineWindow,
} from "@/lib/home/allocation-timeline";

// Today is 2 Aug 2026, so the window runs 1 Jul 2026 – 31 Oct 2026 (123 days).
const TODAY = "2026-08-02";
const WINDOW = timelineWindow(TODAY);

function role(overrides: Partial<TimelineRoleInput> = {}): TimelineRoleInput {
  return {
    roleId: "role-1",
    projectId: "project-1",
    projectName: "Acme Rebuild",
    roleType: "ENGINEER",
    status: "confirmed",
    description: null,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    hoursPerDay: 8,
    ...overrides,
  };
}

describe("timelineWindow", () => {
  test("runs from the start of last month to the end of month +2", () => {
    expect(WINDOW.start).toBe("2026-07-01");
    expect(WINDOW.end).toBe("2026-10-31");
  });

  test("has one tick per month, the first pinned at zero", () => {
    expect(WINDOW.months.map((m) => m.label)).toEqual([
      "Jul",
      "Aug",
      "Sep",
      "Oct",
    ]);
    expect(WINDOW.months[0].pct).toBe(0);
    expect(WINDOW.months[3].pct).toBeGreaterThan(WINDOW.months[2].pct);
  });

  test("month labels carry the year once it turns", () => {
    const yearEnd = timelineWindow("2026-12-15");
    expect(yearEnd.months.map((m) => m.label)).toEqual([
      "Nov",
      "Dec",
      "Jan '27",
      "Feb '27",
    ]);
  });
});

describe("pctOf", () => {
  test("the window's first day is 0 and its last day's end is 100", () => {
    expect(pctOf("2026-07-01", WINDOW)).toBe(0);
    expect(pctOf("2026-11-01", WINDOW)).toBe(100);
  });

  test("dates outside the window clamp rather than going out of range", () => {
    expect(pctOf("2026-01-01", WINDOW)).toBe(0);
    expect(pctOf("2027-01-01", WINDOW)).toBe(100);
  });

  test("today sits inside the window, roughly a quarter in", () => {
    const pct = pctOf(TODAY, WINDOW);
    expect(pct).toBeGreaterThan(20);
    expect(pct).toBeLessThan(35);
  });
});

describe("layoutRow", () => {
  test("a role fully outside the window is dropped", () => {
    expect(
      layoutRow(
        role({ startDate: "2026-01-01", endDate: "2026-06-30" }),
        WINDOW,
      ),
    ).toBeNull();
    expect(
      layoutRow(
        role({ startDate: "2027-01-01", endDate: "2027-06-30" }),
        WINDOW,
      ),
    ).toBeNull();
  });

  test("a role covering the whole window fills it and is clipped both ends", () => {
    const layout = layoutRow(
      role({ startDate: "2026-01-01", endDate: "2027-12-31" }),
      WINDOW,
    );
    expect(layout).toEqual({
      leftPct: 0,
      widthPct: 100,
      clippedStart: true,
      clippedEnd: true,
    });
  });

  test("a role starting before the window is clipped only at the start", () => {
    const layout = layoutRow(
      role({ startDate: "2026-05-01", endDate: "2026-08-31" }),
      WINDOW,
    );
    expect(layout?.leftPct).toBe(0);
    expect(layout?.clippedStart).toBe(true);
    expect(layout?.clippedEnd).toBe(false);
  });

  test("a role inside the window is clipped at neither end", () => {
    const layout = layoutRow(role(), WINDOW);
    expect(layout?.clippedStart).toBe(false);
    expect(layout?.clippedEnd).toBe(false);
    expect(layout?.leftPct).toBeGreaterThan(0);
  });

  test("an inclusive end date fills its own day", () => {
    // 1–31 Aug is 31 of 123 days.
    const layout = layoutRow(role(), WINDOW);
    expect(layout?.widthPct).toBeCloseTo((31 / 123) * 100, 6);
  });

  test("a single-day role stays visible rather than rounding away", () => {
    const layout = layoutRow(
      role({ startDate: "2026-08-10", endDate: "2026-08-10" }),
      WINDOW,
    );
    expect(layout?.widthPct).toBeGreaterThanOrEqual(1);
  });

  test("a min-width bar at the far edge doesn't overflow the track", () => {
    const layout = layoutRow(
      role({ startDate: "2026-10-31", endDate: "2026-10-31" }),
      WINDOW,
    );
    expect(
      (layout?.leftPct ?? 0) + (layout?.widthPct ?? 0),
    ).toBeLessThanOrEqual(100);
  });

  test("inverted dates from a bad import never produce a negative width", () => {
    const layout = layoutRow(
      role({ startDate: "2026-08-31", endDate: "2026-08-01" }),
      WINDOW,
    );
    expect(layout?.widthPct).toBeGreaterThan(0);
  });
});

describe("buildTimelineRows", () => {
  test("current work comes first, heaviest commitment at the top", () => {
    const { rows } = buildTimelineRows(
      [
        role({ roleId: "half", hoursPerDay: 4 }),
        role({ roleId: "full", hoursPerDay: 8 }),
      ],
      TODAY,
      WINDOW,
    );
    expect(rows.map((r) => r.roleId)).toEqual(["full", "half"]);
    expect(rows[0].loadPercent).toBe(100);
    expect(rows[1].loadPercent).toBe(50);
  });

  test("phases order current, then upcoming, then recently ended", () => {
    const { rows } = buildTimelineRows(
      [
        role({
          roleId: "past",
          startDate: "2026-07-01",
          endDate: "2026-07-20",
        }),
        role({
          roleId: "next",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
        role({ roleId: "now" }),
      ],
      TODAY,
      WINDOW,
    );
    expect(rows.map((r) => r.roleId)).toEqual(["now", "next", "past"]);
    expect(rows.map((r) => r.phase)).toEqual(["current", "upcoming", "past"]);
  });

  test("upcoming work is soonest first; past work is most-recent first", () => {
    const { rows } = buildTimelineRows(
      [
        role({
          roleId: "later",
          startDate: "2026-10-01",
          endDate: "2026-10-31",
        }),
        role({
          roleId: "sooner",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
        role({
          roleId: "older",
          startDate: "2026-07-01",
          endDate: "2026-07-10",
        }),
        role({
          roleId: "recent",
          startDate: "2026-07-15",
          endDate: "2026-07-25",
        }),
      ],
      TODAY,
      WINDOW,
    );
    expect(rows.map((r) => r.roleId)).toEqual([
      "sooner",
      "later",
      "recent",
      "older",
    ]);
  });

  test("roles outside the window are counted, not silently dropped", () => {
    const { rows, hiddenCount } = buildTimelineRows(
      [
        role(),
        role({
          roleId: "ancient",
          startDate: "2025-01-01",
          endDate: "2025-02-01",
        }),
      ],
      TODAY,
      WINDOW,
    );
    expect(rows).toHaveLength(1);
    expect(hiddenCount).toBe(1);
  });

  test("the row cap is reported in hiddenCount too", () => {
    const many = Array.from({ length: TIMELINE_MAX_ROWS + 3 }, (_, i) =>
      role({ roleId: `role-${i}` }),
    );
    const { rows, hiddenCount } = buildTimelineRows(many, TODAY, WINDOW);
    expect(rows).toHaveLength(TIMELINE_MAX_ROWS);
    expect(hiddenCount).toBe(3);
  });

  test("no roles yields no rows and nothing hidden", () => {
    expect(buildTimelineRows([], TODAY, WINDOW)).toEqual({
      rows: [],
      hiddenCount: 0,
    });
  });

  test("a role ending today still reads as current, not past", () => {
    const { rows } = buildTimelineRows(
      [role({ startDate: "2026-07-01", endDate: TODAY })],
      TODAY,
      WINDOW,
    );
    expect(rows[0].phase).toBe("current");
  });
});
