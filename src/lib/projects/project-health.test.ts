import { describe, expect, test } from "bun:test";
import {
  PROJECT_HEALTH_MAX,
  PROJECT_HEALTH_MIN,
  PROJECT_HEALTH_UNRATED_LABEL,
  projectHealthLabel,
} from "./project-health";

describe("projectHealthLabel", () => {
  test("an unrated project says so rather than showing a dash", () => {
    expect(projectHealthLabel(null)).toBe(PROJECT_HEALTH_UNRATED_LABEL);
  });

  test("every level on the scale has a label", () => {
    for (let level = PROJECT_HEALTH_MIN; level <= PROJECT_HEALTH_MAX; level++) {
      expect(projectHealthLabel(level)).not.toBe("—");
      expect(projectHealthLabel(level).length).toBeGreaterThan(0);
    }
  });

  test("the labels are distinct", () => {
    const labels = Array.from(
      { length: PROJECT_HEALTH_MAX - PROJECT_HEALTH_MIN + 1 },
      (_, i) => projectHealthLabel(PROJECT_HEALTH_MIN + i),
    );
    // A duplicated label reads as a bug in the UI: two ratings would describe
    // themselves identically while badging differently.
    expect(new Set(labels).size).toBe(labels.length);
  });

  test("out-of-range values fall back rather than throwing", () => {
    expect(projectHealthLabel(PROJECT_HEALTH_MIN - 1)).toBe("—");
    expect(projectHealthLabel(PROJECT_HEALTH_MAX + 1)).toBe("—");
  });
});

describe("the scale's bounds", () => {
  // Pins the contract that three other places encode independently: the
  // `project_delivery_notes_health_range` check constraint, the star input's `max`,
  // and the denominator on the projects-list card. Widening the scale means a
  // migration, so this failing is the reminder to write one.
  test("runs 1–10", () => {
    expect(PROJECT_HEALTH_MIN).toBe(1);
    expect(PROJECT_HEALTH_MAX).toBe(10);
  });
});
