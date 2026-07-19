import { describe, expect, test } from "bun:test";
import {
  computeAverageLevel,
  computeAverageLevelByRole,
  computeLevelDistribution,
  countUnrated,
  type RatingStatRow,
} from "./rating-stats";

describe("computeLevelDistribution", () => {
  test("counts each level L0–L4 in order, excluding unrated", () => {
    const dist = computeLevelDistribution([0, 2, 2, 4, null, 2, null]);
    expect(dist).toEqual([
      { level: 0, count: 1 },
      { level: 1, count: 0 },
      { level: 2, count: 3 },
      { level: 3, count: 0 },
      { level: 4, count: 1 },
    ]);
  });

  test("all-unrated yields all-zero counts (still five buckets)", () => {
    const dist = computeLevelDistribution([null, null]);
    expect(dist.map((d) => d.count)).toEqual([0, 0, 0, 0, 0]);
    expect(dist).toHaveLength(5);
  });

  test("empty input yields five zero buckets", () => {
    expect(computeLevelDistribution([]).map((d) => d.count)).toEqual([
      0, 0, 0, 0, 0,
    ]);
  });
});

describe("countUnrated", () => {
  test("counts nulls only", () => {
    expect(countUnrated([0, null, 3, null, null])).toBe(3);
  });

  test("zero is a rating, not unrated", () => {
    expect(countUnrated([0, 0, 1])).toBe(0);
  });
});

describe("computeAverageLevel", () => {
  test("averages rated people only", () => {
    // (0 + 2 + 4) / 3 = 2
    expect(computeAverageLevel([0, 2, 4, null])).toBe(2);
  });

  test("null when nobody is rated", () => {
    expect(computeAverageLevel([null, null])).toBeNull();
    expect(computeAverageLevel([])).toBeNull();
  });

  test("does not treat L0 as unrated", () => {
    // (0 + 0 + 2) / 3
    expect(computeAverageLevel([0, 0, 2])).toBeCloseTo(2 / 3);
  });
});

describe("computeAverageLevelByRole", () => {
  const rows: RatingStatRow[] = [
    { role: "ENGINEER", level: 2 },
    { role: "ENGINEER", level: 4 },
    { role: "ENGINEER", level: null },
    { role: "DESIGNER", level: null },
    { role: "QA", level: 1 },
  ];

  test("emits roles in the given order, skipping empty roles", () => {
    const result = computeAverageLevelByRole(rows, [
      "ENGINEER",
      "LEADERSHIP", // nobody → skipped
      "DESIGNER",
      "QA",
    ]);
    expect(result.map((r) => r.role)).toEqual(["ENGINEER", "DESIGNER", "QA"]);
  });

  test("averages a role's rated members and reports the rated count", () => {
    const [engineer] = computeAverageLevelByRole(rows, ["ENGINEER"]);
    expect(engineer).toEqual({
      role: "ENGINEER",
      averageLevel: 3, // (2 + 4) / 2
      ratedCount: 2,
    });
  });

  test("role present but all unrated → null average, zero rated count", () => {
    const [designer] = computeAverageLevelByRole(rows, ["DESIGNER"]);
    expect(designer).toEqual({
      role: "DESIGNER",
      averageLevel: null,
      ratedCount: 0,
    });
  });
});
