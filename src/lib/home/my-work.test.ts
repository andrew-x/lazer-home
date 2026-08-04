import { describe, expect, test } from "bun:test";
import type { MyAllocationRole } from "@/actions/allocations/getMyAllocations";
import { buildMyAllocationRows, currentLoadPercent } from "@/lib/home/my-work";

const TODAY = "2026-08-02";

function role(overrides: Partial<MyAllocationRole> = {}): MyAllocationRole {
  return {
    roleId: "role-1",
    projectId: "project-1",
    projectName: "Acme Rebuild",
    companyName: "Acme",
    roleType: "ENGINEER",
    status: "confirmed",
    description: null,
    startDate: "2026-07-01",
    endDate: "2026-09-30",
    hoursPerDay: 8,
    ...overrides,
  };
}

describe("buildMyAllocationRows — live vs upcoming", () => {
  test("a role spanning today is live", () => {
    const { live, upcoming } = buildMyAllocationRows([role()], TODAY);
    expect(live.map((r) => r.projectName)).toEqual(["Acme Rebuild"]);
    expect(upcoming).toHaveLength(0);
  });

  test("a role starting later is upcoming, not live", () => {
    const { live, upcoming } = buildMyAllocationRows(
      [role({ startDate: "2026-09-01", endDate: "2026-12-31" })],
      TODAY,
    );
    expect(live).toHaveLength(0);
    expect(upcoming).toHaveLength(1);
  });

  test("a role starting or ending exactly today is live at both boundaries", () => {
    expect(
      buildMyAllocationRows([role({ startDate: TODAY })], TODAY).live,
    ).toHaveLength(1);
    expect(
      buildMyAllocationRows([role({ endDate: TODAY })], TODAY).live,
    ).toHaveLength(1);
  });

  test("a role far in the future is still listed — the table has no forward bound", () => {
    const { upcoming } = buildMyAllocationRows(
      [role({ startDate: "2027-06-01", endDate: "2027-12-31" })],
      TODAY,
    );
    expect(upcoming).toHaveLength(1);
  });
});

describe("buildMyAllocationRows — merging roles on one project", () => {
  test("two roles on one project become one row summing hours", () => {
    const { live } = buildMyAllocationRows(
      [
        role({ roleId: "a", hoursPerDay: 4 }),
        role({ roleId: "b", roleType: "ARCHITECT", hoursPerDay: 2 }),
      ],
      TODAY,
    );
    expect(live).toHaveLength(1);
    expect(live[0].hoursPerDay).toBe(6);
    expect(live[0].roleTypes).toEqual(["ENGINEER", "ARCHITECT"]);
  });

  test("the merged span covers the earliest start and latest end", () => {
    const { live } = buildMyAllocationRows(
      [
        role({ roleId: "a", startDate: "2026-07-01", endDate: "2026-08-31" }),
        role({ roleId: "b", startDate: "2026-06-01", endDate: "2026-09-30" }),
      ],
      TODAY,
    );
    expect(live[0].startDate).toBe("2026-06-01");
    expect(live[0].endDate).toBe("2026-09-30");
  });

  test("a duplicated role type is not repeated in the sub-line", () => {
    const { live } = buildMyAllocationRows(
      [role({ roleId: "a" }), role({ roleId: "b" })],
      TODAY,
    );
    expect(live[0].roleTypes).toEqual(["ENGINEER"]);
  });

  // Regression: merging across the live/upcoming boundary reported the *sum* of a
  // current and a future role as today's commitment, and hid the future one.
  test("a future phase on the same project does not inflate today's hours", () => {
    const { live, upcoming } = buildMyAllocationRows(
      [
        role({
          roleId: "now",
          hoursPerDay: 4,
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        }),
        role({
          roleId: "later",
          hoursPerDay: 4,
          startDate: "2026-11-01",
          endDate: "2027-03-31",
        }),
      ],
      TODAY,
    );
    expect(live).toHaveLength(1);
    expect(live[0].hoursPerDay).toBe(4);
    expect(live[0].endDate).toBe("2026-12-31");
    // The step-up is still visible, on its own start date.
    expect(upcoming).toHaveLength(1);
    expect(upcoming[0].hoursPerDay).toBe(4);
    expect(upcoming[0].startDate).toBe("2026-11-01");
  });

  test("a project in both buckets gets distinct row keys", () => {
    const { live, upcoming } = buildMyAllocationRows(
      [
        role({ roleId: "now", startDate: "2026-01-01", endDate: "2026-12-31" }),
        role({
          roleId: "later",
          startDate: "2026-11-01",
          endDate: "2027-03-31",
        }),
      ],
      TODAY,
    );
    expect(live[0].key).not.toBe(upcoming[0].key);
  });

  test("a tentative role today is not made confirmed by a future confirmed one", () => {
    const { live } = buildMyAllocationRows(
      [
        role({
          roleId: "now",
          status: "tentative",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        }),
        role({
          roleId: "later",
          status: "confirmed",
          startDate: "2026-11-01",
          endDate: "2027-03-31",
        }),
      ],
      TODAY,
    );
    expect(live[0].status).toBe("tentative");
  });

  test("concurrent roles on one project still merge", () => {
    // The guard must not over-correct: two roles both live today are one commitment.
    const { live } = buildMyAllocationRows(
      [
        role({ roleId: "a", hoursPerDay: 4 }),
        role({ roleId: "b", roleType: "QA", hoursPerDay: 2 }),
      ],
      TODAY,
    );
    expect(live).toHaveLength(1);
    expect(live[0].hoursPerDay).toBe(6);
  });

  test("all-tentative reads tentative; one confirmed role makes it real", () => {
    const allTentative = buildMyAllocationRows(
      [
        role({ roleId: "a", status: "tentative" }),
        role({ roleId: "b", status: "tentative" }),
      ],
      TODAY,
    );
    expect(allTentative.live[0].status).toBe("tentative");

    const mixed = buildMyAllocationRows(
      [
        role({ roleId: "a", status: "tentative" }),
        role({ roleId: "b", status: "confirmed" }),
      ],
      TODAY,
    );
    expect(mixed.live[0].status).toBe("confirmed");
  });
});

describe("buildMyAllocationRows — running delivery", () => {
  test("a DELIVERY role is an ordinary row, with its real hours", () => {
    // It used to be a special "delivery lead" row with null hours, because the old
    // junction carried neither dates nor hours (ADR 0068).
    const { live } = buildMyAllocationRows(
      [role({ roleType: "DELIVERY", hoursPerDay: 2 })],
      TODAY,
    );
    expect(live[0]).toMatchObject({
      projectName: "Acme Rebuild",
      roleTypes: ["DELIVERY"],
      hoursPerDay: 2,
    });
  });

  test("running a project you also hold a role on yields one row summing both", () => {
    const { live } = buildMyAllocationRows(
      [
        role({ roleId: "eng", hoursPerDay: 6 }),
        role({ roleId: "dm", roleType: "DELIVERY", hoursPerDay: 2 }),
      ],
      TODAY,
    );
    expect(live).toHaveLength(1);
    expect(live[0].hoursPerDay).toBe(8);
    expect(live[0].roleTypes).toEqual(["ENGINEER", "DELIVERY"]);
  });
});

describe("buildMyAllocationRows — ordering", () => {
  test("live rows are heaviest first", () => {
    const { live } = buildMyAllocationRows(
      [
        role({
          roleId: "l",
          projectId: "p-l",
          projectName: "Light",
          hoursPerDay: 2,
        }),
        role({
          roleId: "h",
          projectId: "p-h",
          projectName: "Heavy",
          hoursPerDay: 8,
        }),
      ],
      TODAY,
    );
    expect(live.map((r) => r.projectName)).toEqual(["Heavy", "Light"]);
  });

  test("equal hours break the tie by project name", () => {
    const { live } = buildMyAllocationRows(
      [
        role({ roleId: "b", projectId: "p-b", projectName: "Beta" }),
        role({ roleId: "a", projectId: "p-a", projectName: "Alpha" }),
      ],
      TODAY,
    );
    expect(live.map((r) => r.projectName)).toEqual(["Alpha", "Beta"]);
  });

  test("upcoming rows are soonest start first", () => {
    const { upcoming } = buildMyAllocationRows(
      [
        role({
          roleId: "later",
          projectId: "p-later",
          projectName: "Later",
          startDate: "2026-11-01",
          endDate: "2026-12-31",
        }),
        role({
          roleId: "sooner",
          projectId: "p-sooner",
          projectName: "Sooner",
          startDate: "2026-09-01",
          endDate: "2026-10-31",
        }),
      ],
      TODAY,
    );
    expect(upcoming.map((r) => r.projectName)).toEqual(["Sooner", "Later"]);
  });
});

describe("currentLoadPercent", () => {
  test("sums confirmed roles active today", () => {
    expect(
      currentLoadPercent(
        [
          role({ roleId: "a", hoursPerDay: 4 }),
          role({ roleId: "b", hoursPerDay: 2 }),
        ],
        TODAY,
      ),
    ).toBe(75);
  });

  test("tentative work does not count as committed load", () => {
    expect(currentLoadPercent([role({ status: "tentative" })], TODAY)).toBe(0);
  });

  test("over-allocation is reported above 100, never clamped", () => {
    expect(
      currentLoadPercent([role({ roleId: "a" }), role({ roleId: "b" })], TODAY),
    ).toBe(200);
  });

  test("nothing on today is zero", () => {
    expect(currentLoadPercent([role({ startDate: "2026-09-01" })], TODAY)).toBe(
      0,
    );
  });
});
