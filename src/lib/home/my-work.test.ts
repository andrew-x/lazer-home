import { describe, expect, test } from "bun:test";
import type {
  MyAllocationRole,
  MyManagedProject,
} from "@/actions/allocations/getMyAllocations";
import {
  activeProjects,
  currentLoadPercent,
  nextStartDate,
} from "@/lib/home/my-work";

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

function managed(overrides: Partial<MyManagedProject> = {}): MyManagedProject {
  return {
    projectId: "project-9",
    projectName: "Beta Platform",
    companyName: "Beta",
    liveStart: "2026-07-01",
    liveEnd: "2026-09-30",
    ...overrides,
  };
}

describe("activeProjects", () => {
  test("a role spanning today is active, with its nominal load", () => {
    const [project] = activeProjects([role()], [], TODAY);
    expect(project).toMatchObject({ projectId: "project-1", loadPercent: 100 });
  });

  test("roles outside today are excluded", () => {
    expect(
      activeProjects(
        [
          role({ roleId: "past", endDate: "2026-07-20" }),
          role({ roleId: "future", startDate: "2026-09-01" }),
        ],
        [],
        TODAY,
      ),
    ).toEqual([]);
  });

  test("a role starting or ending exactly today still counts", () => {
    expect(
      activeProjects([role({ startDate: TODAY })], [], TODAY),
    ).toHaveLength(1);
    expect(activeProjects([role({ endDate: TODAY })], [], TODAY)).toHaveLength(
      1,
    );
  });

  test("two roles on one project merge into one entry summing their load", () => {
    const projects = activeProjects(
      [
        role({ roleId: "eng", hoursPerDay: 4 }),
        role({ roleId: "arch", roleType: "ARCHITECT", hoursPerDay: 2 }),
      ],
      [],
      TODAY,
    );
    expect(projects).toHaveLength(1);
    expect(projects[0].loadPercent).toBe(75);
  });

  test("a project is tentative-only when every role on it is", () => {
    const bothTentative = activeProjects(
      [
        role({ roleId: "a", status: "tentative" }),
        role({ roleId: "b", status: "tentative" }),
      ],
      [],
      TODAY,
    );
    expect(bothTentative[0].tentativeOnly).toBe(true);

    const mixed = activeProjects(
      [role({ roleId: "a", status: "tentative" }), role({ roleId: "b" })],
      [],
      TODAY,
    );
    expect(mixed[0].tentativeOnly).toBe(false);
  });

  test("a delivery-manager seat counts as active, with no fabricated load", () => {
    const [project] = activeProjects([], [managed()], TODAY);
    expect(project).toMatchObject({
      projectId: "project-9",
      loadPercent: null,
      deliveryManagerOnly: true,
    });
  });

  test("a managed project with no live roles is not active", () => {
    expect(
      activeProjects([], [managed({ liveStart: null, liveEnd: null })], TODAY),
    ).toEqual([]);
  });

  test("a managed project whose live span has ended is not active", () => {
    expect(
      activeProjects([], [managed({ liveEnd: "2026-07-15" })], TODAY),
    ).toEqual([]);
  });

  test("holding a role on a project you also manage counts once, with the load", () => {
    const projects = activeProjects(
      [role({ projectId: "project-9", projectName: "Beta Platform" })],
      [managed()],
      TODAY,
    );
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      loadPercent: 100,
      deliveryManagerOnly: false,
    });
  });

  test("heaviest first, then by name, with DM-only seats last", () => {
    const projects = activeProjects(
      [
        role({
          roleId: "b",
          projectId: "p-b",
          projectName: "Beta",
          hoursPerDay: 4,
        }),
        role({
          roleId: "a",
          projectId: "p-a",
          projectName: "Alpha",
          hoursPerDay: 8,
        }),
      ],
      [managed({ projectId: "p-z", projectName: "Zeta" })],
      TODAY,
    );
    expect(projects.map((p) => p.projectName)).toEqual([
      "Alpha",
      "Beta",
      "Zeta",
    ]);
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

describe("nextStartDate", () => {
  test("returns the soonest future start", () => {
    expect(
      nextStartDate(
        [
          role({ roleId: "later", startDate: "2026-10-01" }),
          role({ roleId: "sooner", startDate: "2026-09-01" }),
        ],
        TODAY,
      ),
    ).toBe("2026-09-01");
  });

  test("ignores roles already under way", () => {
    expect(nextStartDate([role()], TODAY)).toBeNull();
  });

  test("nothing booked is null", () => {
    expect(nextStartDate([], TODAY)).toBeNull();
  });
});
