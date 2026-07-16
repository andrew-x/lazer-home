import { describe, expect, test } from "bun:test";
import {
  computeByRole,
  computeGroupStats,
  type StatRow,
} from "./performance-stats";

const rows: StatRow[] = [
  { role: "ENGINEER", comp: 100, hourly: 50 },
  { role: "ENGINEER", comp: 200, hourly: 70 },
  { role: "DESIGNER", comp: 150, hourly: 60 },
];

describe("computeGroupStats", () => {
  test("computes headcount, averages, and ranges", () => {
    const stats = computeGroupStats(rows);
    expect(stats.headcount).toBe(3);
    expect(stats.avgComp).toBeCloseTo(150); // (100+200+150)/3
    expect(stats.minComp).toBe(100);
    expect(stats.maxComp).toBe(200);
    expect(stats.avgHourly).toBeCloseTo(60); // (50+70+60)/3
    expect(stats.minHourly).toBe(50);
    expect(stats.maxHourly).toBe(70);
  });

  test("returns nulls (not NaN) for an empty group", () => {
    const stats = computeGroupStats([]);
    expect(stats).toEqual({
      headcount: 0,
      avgComp: null,
      minComp: null,
      maxComp: null,
      avgHourly: null,
      minHourly: null,
      maxHourly: null,
    });
  });
});

describe("computeByRole", () => {
  test("splits by role and follows the given role order, skipping empties", () => {
    const { overall, byRole } = computeByRole(rows, [
      "DESIGNER",
      "ENGINEER",
      "QA",
    ]);

    expect(overall.headcount).toBe(3);

    // QA has no rows → omitted; DESIGNER before ENGINEER per roleOrder.
    expect(byRole.map((b) => b.role)).toEqual(["DESIGNER", "ENGINEER"]);

    const engineers = byRole.find((b) => b.role === "ENGINEER");
    expect(engineers?.stats.headcount).toBe(2);
    expect(engineers?.stats.avgComp).toBeCloseTo(150);
    expect(engineers?.stats.minComp).toBe(100);
    expect(engineers?.stats.maxComp).toBe(200);
  });
});
