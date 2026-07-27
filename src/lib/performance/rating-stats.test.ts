import { describe, expect, test } from "bun:test";
import { computeAverageSubratingsByRole } from "./rating-stats";

describe("computeAverageSubratingsByRole", () => {
  test("averages each engineer category over people who scored it", () => {
    const result = computeAverageSubratingsByRole(
      [
        {
          role: "ENGINEER",
          subratings: { communications: 2, technical_depth: 4 },
        },
        {
          role: "ENGINEER",
          subratings: { communications: 4 },
        },
        // Unrated engineer contributes to no category.
        { role: "ENGINEER", subratings: null },
      ],
      ["ENGINEER", "SALES"],
    );

    expect(result).toHaveLength(1);
    const engineer = result[0];
    expect(engineer.role).toBe("ENGINEER");

    const comms = engineer.categories.find((c) => c.key === "communications");
    expect(comms?.average).toBe(3); // (2 + 4) / 2
    expect(comms?.ratedCount).toBe(2);

    const depth = engineer.categories.find((c) => c.key === "technical_depth");
    expect(depth?.average).toBe(4);
    expect(depth?.ratedCount).toBe(1);

    // A category nobody scored is present but null with a zero count.
    const breadth = engineer.categories.find(
      (c) => c.key === "technical_breadth",
    );
    expect(breadth?.average).toBeNull();
    expect(breadth?.ratedCount).toBe(0);
  });

  test("omits roles with no rubric and roles with no scored categories", () => {
    const result = computeAverageSubratingsByRole(
      [
        { role: "SALES", subratings: null },
        { role: "ENGINEER", subratings: null },
      ],
      ["ENGINEER", "SALES"],
    );
    // SALES has no rubric; ENGINEER has a rubric but nothing scored.
    expect(result).toEqual([]);
  });
});
