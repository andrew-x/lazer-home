import { describe, expect, test } from "bun:test";
import {
  ALL_RUBRIC_KEYS,
  ROLE_RUBRICS,
  RUBRIC_LABELS,
  rubricForRole,
  SUBRATING_LEVELS,
} from "./rating-rubric";

describe("rubricForRole", () => {
  test("returns the engineer rubric with all 8 categories", () => {
    const rubric = rubricForRole("ENGINEER");
    expect(rubric.map((c) => c.key)).toEqual([
      "communications",
      "project_management",
      "relationship_management",
      "outcomes_ownership",
      "technical_depth",
      "technical_breadth",
      "output_craft",
      "ai_tooling_competency",
    ]);
  });

  test("returns [] for a role without a rubric and for null", () => {
    expect(rubricForRole("SALES")).toEqual([]);
    expect(rubricForRole(null)).toEqual([]);
  });
});

describe("rubric key union", () => {
  test("ALL_RUBRIC_KEYS is the deduped union across roles", () => {
    const union = new Set(
      Object.values(ROLE_RUBRICS).flatMap((cats) =>
        (cats ?? []).map((c) => c.key),
      ),
    );
    expect(new Set(ALL_RUBRIC_KEYS)).toEqual(union);
    // No duplicate keys.
    expect(ALL_RUBRIC_KEYS.length).toBe(new Set(ALL_RUBRIC_KEYS).size);
  });

  test("every key has a label", () => {
    for (const key of ALL_RUBRIC_KEYS) {
      expect(RUBRIC_LABELS[key]).toBeTruthy();
    }
  });
});

describe("subrating levels", () => {
  test("are L1–L4 (no L0)", () => {
    expect(SUBRATING_LEVELS).toEqual([1, 2, 3, 4]);
  });
});
