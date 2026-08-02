import { describe, expect, test } from "bun:test";
import type { ProjectAllocationRoleRow } from "@/actions/allocations/getProjectAllocationsGrid";
import { buildProjectAllocationRows } from "./project-allocations-grid";

// Two full working weeks: 2026-07-06 (Mon) → 2026-07-17 (Fri).
const WEEK_ONE = "2026-07-06";
const WEEK_TWO = "2026-07-13";
const WEEKS = [WEEK_ONE, WEEK_TWO];

function role(
  overrides: Partial<ProjectAllocationRoleRow> & { id: string },
): ProjectAllocationRoleRow {
  return {
    projectId: "prj_a",
    projectName: "Acme Redesign",
    companyName: "Acme",
    roleType: "ENGINEER",
    status: "confirmed",
    lineOfBusiness: "CORE",
    description: null,
    startDate: WEEK_ONE,
    endDate: "2026-07-17",
    hoursPerDay: 8,
    staffId: "stf_1",
    staffName: "Ada Chen",
    ...overrides,
  };
}

describe("buildProjectAllocationRows", () => {
  test("groups roles under their project and keeps read order", () => {
    const rows = buildProjectAllocationRows(
      [
        role({ id: "rol_1" }),
        role({ id: "rol_2", roleType: "DESIGNER" }),
        role({ id: "rol_3", projectId: "prj_b", projectName: "Northwind" }),
      ],
      WEEKS,
      "week",
    );

    expect(rows.map((r) => r.projectName)).toEqual([
      "Acme Redesign",
      "Northwind",
    ]);
    expect(rows[0].roles.map((line) => line.role.id)).toEqual([
      "rol_1",
      "rol_2",
    ]);
  });

  test("rolls a project's role percentages up into FTE per column", () => {
    // 8h/day (100%) + 4h/day (50%) across both weeks → 1.5 FTE.
    const rows = buildProjectAllocationRows(
      [role({ id: "rol_1" }), role({ id: "rol_2", hoursPerDay: 4 })],
      WEEKS,
      "week",
    );

    expect(rows[0].cells.map((cell) => cell.fte)).toEqual([1.5, 1.5]);
  });

  test("counts only the open roles active in each column", () => {
    const rows = buildProjectAllocationRows(
      [
        role({ id: "rol_1" }),
        // Open, and only present in the second week.
        role({
          id: "rol_2",
          staffId: null,
          staffName: null,
          startDate: WEEK_TWO,
          endDate: "2026-07-17",
        }),
      ],
      WEEKS,
      "week",
    );

    expect(rows[0].cells.map((cell) => cell.openCount)).toEqual([0, 1]);
    expect(rows[0].hasOpenRole).toBe(true);
    // An open role still counts toward the planned shape of the project.
    expect(rows[0].cells.map((cell) => cell.fte)).toEqual([1, 2]);
  });

  test("counts running roles even when their load rounds to 0 FTE", () => {
    // A half-day on a single day is 1% of the week — 0.0 FTE once rounded, but
    // the project is plainly running, so the cell must not read as empty.
    const rows = buildProjectAllocationRows(
      [
        role({
          id: "rol_1",
          hoursPerDay: 0.5,
          startDate: WEEK_ONE,
          endDate: WEEK_ONE,
        }),
      ],
      WEEKS,
      "week",
    );

    expect(rows[0].cells[0]).toMatchObject({ fte: 0, roleCount: 1 });
    expect(rows[0].cells[1]).toMatchObject({ fte: 0, roleCount: 0 });
  });

  test("a project with no open role is not flagged", () => {
    const rows = buildProjectAllocationRows(
      [role({ id: "rol_1" })],
      WEEKS,
      "week",
    );
    expect(rows[0].hasOpenRole).toBe(false);
    expect(rows[0].cells.every((cell) => cell.openCount === 0)).toBe(true);
  });

  test("drops roles idle in every column, and projects left empty", () => {
    const rows = buildProjectAllocationRows(
      [
        role({ id: "rol_1" }),
        // Entirely after the window.
        role({
          id: "rol_2",
          startDate: "2026-09-01",
          endDate: "2026-09-30",
        }),
        // A whole project outside the window.
        role({
          id: "rol_3",
          projectId: "prj_b",
          projectName: "Northwind",
          startDate: "2026-01-05",
          endDate: "2026-01-09",
        }),
      ],
      WEEKS,
      "week",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].roles.map((line) => line.role.id)).toEqual(["rol_1"]);
  });

  test("week columns prorate a partial start week, like the staff view", () => {
    // Starts Wednesday: 3 active weekdays of 5 → 8h × 3 / 40 = 60%.
    const rows = buildProjectAllocationRows(
      [role({ id: "rol_1", startDate: "2026-07-08" })],
      WEEKS,
      "week",
    );

    expect(rows[0].roles[0].cells.map((cell) => cell.percent)).toEqual([
      60, 100,
    ]);
    expect(rows[0].cells.map((cell) => cell.fte)).toEqual([0.6, 1]);
  });

  test("marks the columns a role starts and ends in", () => {
    const rows = buildProjectAllocationRows(
      [role({ id: "rol_1", startDate: "2026-07-08", endDate: "2026-07-15" })],
      WEEKS,
      "week",
    );

    const [first, second] = rows[0].roles[0].cells;
    expect(first).toMatchObject({ isStart: true, isEnd: false });
    expect(second).toMatchObject({ isStart: false, isEnd: true });
  });

  test("sorts projects with open roles first, then by name", () => {
    const rows = buildProjectAllocationRows(
      [
        role({ id: "rol_1", projectId: "prj_a", projectName: "Alpha" }),
        role({ id: "rol_2", projectId: "prj_b", projectName: "Bravo" }),
        role({
          id: "rol_3",
          projectId: "prj_z",
          projectName: "Zulu",
          staffId: null,
          staffName: null,
        }),
      ],
      WEEKS,
      "week",
    );

    expect(rows.map((r) => r.projectName)).toEqual(["Zulu", "Alpha", "Bravo"]);
  });
});
