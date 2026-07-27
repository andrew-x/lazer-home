import { describe, expect, test } from "bun:test";
import type { AllocatedProject } from "@/actions/timesheets/getTimesheetPrefill";
import {
  applyAllocationFill,
  applyPtoFill,
  type Row,
  targetKey,
} from "./timesheet-grid";

// A Mon–Sun week: weekdays 20–24, weekend 25–26.
const WEEK = [
  "2026-07-20",
  "2026-07-21",
  "2026-07-22",
  "2026-07-23",
  "2026-07-24",
  "2026-07-25",
  "2026-07-26",
];
const CAP = 8;

function projectRow(id: string, hours: Record<string, string>): Row {
  return {
    key: targetKey(id, null),
    label: `Project ${id}`,
    sublabel: "Acme",
    projectId: id,
    category: null,
    hours,
  };
}

function allocation(
  projectId: string,
  hoursByDate: Record<string, number>,
): AllocatedProject {
  return {
    projectId,
    name: `Project ${projectId}`,
    companyName: "Acme",
    hoursByDate,
  };
}

describe("applyAllocationFill", () => {
  test("adds a new project row with the allocated hours on weekdays", () => {
    const result = applyAllocationFill(
      [],
      [allocation("p1", { "2026-07-20": 8, "2026-07-21": 4 })],
      WEEK,
      CAP,
    );
    expect(result).toHaveLength(1);
    expect(result[0].projectId).toBe("p1");
    expect(result[0].hours).toEqual({ "2026-07-20": "8", "2026-07-21": "4" });
  });

  test("merges into an existing row without clobbering entered hours", () => {
    const existing = projectRow("p1", { "2026-07-20": "3" });
    const result = applyAllocationFill(
      [existing],
      [allocation("p1", { "2026-07-20": 8, "2026-07-21": 5 })],
      WEEK,
      CAP,
    );
    expect(result).toHaveLength(1);
    // The user's 3h on Mon is preserved; Tue is filled from the allocation.
    expect(result[0].hours).toEqual({ "2026-07-20": "3", "2026-07-21": "5" });
  });

  test("caps each day at the total across other rows", () => {
    const other = projectRow("p0", { "2026-07-20": "6" });
    const result = applyAllocationFill(
      [other],
      [allocation("p1", { "2026-07-20": 8 })],
      WEEK,
      CAP,
    );
    const p1 = result.find((r) => r.projectId === "p1");
    // 8h allocated but only 2h of capacity remains that day.
    expect(p1?.hours).toEqual({ "2026-07-20": "2" });
  });

  test("ignores weekend dates in the allocation", () => {
    const result = applyAllocationFill(
      [],
      [allocation("p1", { "2026-07-25": 8, "2026-07-20": 8 })],
      WEEK,
      CAP,
    );
    expect(result[0].hours).toEqual({ "2026-07-20": "8" });
  });

  test("does not add an empty ghost row when no capacity remains", () => {
    const full = projectRow("p0", { "2026-07-20": "8" });
    const result = applyAllocationFill(
      [full],
      [allocation("p1", { "2026-07-20": 8 })],
      WEEK,
      CAP,
    );
    expect(result).toHaveLength(1);
    expect(result[0].projectId).toBe("p0");
  });
});

describe("applyPtoFill", () => {
  test("adds a PTO category row at the given hours", () => {
    const result = applyPtoFill([], { "2026-07-22": 8 }, WEEK, CAP);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("PTO");
    expect(result[0].projectId).toBeNull();
    expect(result[0].hours).toEqual({ "2026-07-22": "8" });
  });

  test("merges into an existing PTO row without clobbering entered hours", () => {
    const existing: Row = {
      key: targetKey(null, "PTO"),
      label: "PTO",
      sublabel: "Non-billable",
      projectId: null,
      category: "PTO",
      hours: { "2026-07-22": "4" },
    };
    const result = applyPtoFill(
      [existing],
      { "2026-07-22": 8, "2026-07-23": 8 },
      WEEK,
      CAP,
    );
    expect(result).toHaveLength(1);
    expect(result[0].hours).toEqual({ "2026-07-22": "4", "2026-07-23": "8" });
  });
});
