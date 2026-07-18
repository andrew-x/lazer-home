import { describe, expect, test } from "bun:test";
import type { PlanRole } from "@/actions/projects/getOpportunityPlan";
import { buildPlannerRows, buildWeekColumns } from "./project-planner-grid";

// 2026-07-06, -13, -20, -27 are consecutive Mondays.
const CURRENT_OPP = "opp-current";

function role(
  overrides: Partial<PlanRole> & {
    id: string;
    startDate: string;
    endDate: string;
  },
): PlanRole {
  return {
    staffId: null,
    staffName: null,
    name: null,
    roleType: "ENGINEER",
    status: "tentative",
    opportunityId: CURRENT_OPP,
    hoursPerDay: 8,
    ...overrides,
  };
}

describe("buildWeekColumns", () => {
  test("spans min start to max end as ISO Mondays", () => {
    const cols = buildWeekColumns([
      role({ id: "r1", startDate: "2026-07-08", endDate: "2026-07-15" }),
      role({ id: "r2", startDate: "2026-07-21", endDate: "2026-07-22" }),
    ]);
    expect(cols).toEqual(["2026-07-06", "2026-07-13", "2026-07-20"]);
  });

  test("a role inside one week yields a single column", () => {
    const cols = buildWeekColumns([
      role({ id: "r1", startDate: "2026-07-08", endDate: "2026-07-09" }),
    ]);
    expect(cols).toEqual(["2026-07-06"]);
  });

  test("no roles → no columns", () => {
    expect(buildWeekColumns([])).toEqual([]);
  });
});

describe("buildPlannerRows", () => {
  test("groups a person's segments into one row; a gap week is inactive", () => {
    const roles = [
      role({
        id: "r1",
        staffId: "s1",
        staffName: "Ada Lovelace",
        startDate: "2026-07-06",
        endDate: "2026-07-06",
      }),
      role({
        id: "r2",
        staffId: "s1",
        staffName: "Ada Lovelace",
        startDate: "2026-07-20",
        endDate: "2026-07-20",
      }),
    ];
    const cols = buildWeekColumns(roles); // [07-06, 07-13, 07-20]
    const rows = buildPlannerRows(roles, cols, CURRENT_OPP);

    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe("staff:s1");
    expect(rows[0].label).toBe("Ada Lovelace");
    expect(rows[0].segments).toHaveLength(2);
    // Active in the two end weeks, inactive in the gap week.
    expect(rows[0].active).toEqual([true, false, true]);
  });

  test("each placeholder role is its own row", () => {
    const roles = [
      role({
        id: "p1",
        name: "Backend lead",
        startDate: "2026-07-06",
        endDate: "2026-07-13",
      }),
      role({
        id: "p2",
        roleType: "DESIGNER",
        startDate: "2026-07-06",
        endDate: "2026-07-13",
      }),
    ];
    const cols = buildWeekColumns(roles);
    const rows = buildPlannerRows(roles, cols, CURRENT_OPP);

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.staffId === null)).toBe(true);
    // Labels: explicit name, else the role-type label.
    expect(rows.map((r) => r.label).sort()).toEqual([
      "Backend lead",
      "Designer",
    ]);
    expect(rows.every((r) => r.sublabel === "Open position")).toBe(true);
  });

  test("editability: only this opportunity's tentative roles are editable", () => {
    const roles = [
      role({
        id: "own-tentative",
        staffId: "s1",
        staffName: "A",
        startDate: "2026-07-06",
        endDate: "2026-07-06",
      }),
      role({
        id: "own-confirmed",
        staffId: "s2",
        staffName: "B",
        status: "confirmed",
        startDate: "2026-07-06",
        endDate: "2026-07-06",
      }),
      role({
        id: "other-opp",
        staffId: "s3",
        staffName: "C",
        opportunityId: "opp-other",
        startDate: "2026-07-06",
        endDate: "2026-07-06",
      }),
    ];
    const cols = buildWeekColumns(roles);
    const rows = buildPlannerRows(roles, cols, CURRENT_OPP);
    const editableById = new Map(
      rows.flatMap((r) => r.segments.map((s) => [s.roleId, s.editable])),
    );

    expect(editableById.get("own-tentative")).toBe(true);
    expect(editableById.get("own-confirmed")).toBe(false); // confirmed → locked
    expect(editableById.get("other-opp")).toBe(false); // other opportunity
  });

  test("staffed rows sort before placeholders", () => {
    const roles = [
      role({
        id: "p1",
        name: "Zeta open",
        startDate: "2026-07-06",
        endDate: "2026-07-06",
      }),
      role({
        id: "r1",
        staffId: "s1",
        staffName: "Yolanda",
        startDate: "2026-07-06",
        endDate: "2026-07-06",
      }),
    ];
    const cols = buildWeekColumns(roles);
    const rows = buildPlannerRows(roles, cols, CURRENT_OPP);
    expect(rows.map((r) => r.key)).toEqual(["staff:s1", "role:p1"]);
  });
});
