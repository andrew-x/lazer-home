import { describe, expect, test } from "bun:test";
import type {
  AllocationRoleRow,
  AllocationStaffRow,
  AllocationTimeOff,
  OpenRoleRow,
} from "@/actions/allocations/getAllocationsGrid";
import {
  buildAvailabilityTabs,
  buildOrgStatus,
  DELIVERY_ROLES,
  filterByEmploymentType,
  filterByLineOfBusiness,
  groupRolesByProject,
  type OrgPerson,
  type OrgUpcomingRole,
  summarizeStaffing,
} from "@/lib/home/org-status";
import { isBillableRole, ROLE_LABELS } from "@/lib/staff/staff-enums";

/** Every role in the enum, via the label map's keys. */
const ALL_ROLES = Object.keys(ROLE_LABELS) as (keyof typeof ROLE_LABELS)[];

// 2026-07-27 is a Monday, so it is a valid week start for the availability fold.
const TODAY = "2026-07-29";
const WEEK = "2026-07-27";

function person(
  overrides: Partial<AllocationStaffRow> = {},
): AllocationStaffRow {
  return {
    id: "staff-1",
    name: "Ada Lovelace",
    lineOfBusiness: "CORE",
    role: "ENGINEER",
    employmentType: "FULL_TIME",
    isBillable: true,
    skills: [],
    allocationNotes: null,
    ...overrides,
  };
}

function role(overrides: Partial<AllocationRoleRow> = {}): AllocationRoleRow {
  return {
    id: "role-1",
    staffId: "staff-1",
    projectId: "project-1",
    projectName: "Acme Rebuild",
    roleType: "ENGINEER",
    status: "confirmed",
    lineOfBusiness: "CORE",
    description: null,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    hoursPerDay: 8,
    ...overrides,
  };
}

function openRole(overrides: Partial<OpenRoleRow> = {}): OpenRoleRow {
  const { staffId: _staffId, ...rest } = role();
  return { ...rest, id: "open-1", ...overrides };
}

function leave(overrides: Partial<AllocationTimeOff> = {}): AllocationTimeOff {
  return {
    staffId: "staff-1",
    startDate: "2026-08-10",
    endDate: "2026-08-14",
    type: "VACATION",
    ...overrides,
  };
}

/** A minimal person record for the pure summarizers. */
function orgPerson(overrides: Partial<OrgPerson> = {}): OrgPerson {
  return {
    staffId: "staff-1",
    name: "Ada Lovelace",
    role: "ENGINEER",
    lineOfBusiness: "CORE",
    employmentType: "FULL_TIME",
    weeks: [],
    tentativeOnly: false,
    staffedToday: false,
    ...overrides,
  };
}

function build(
  staff: AllocationStaffRow[],
  roles: AllocationRoleRow[] = [],
  openRoles: OpenRoleRow[] = [],
  timeOff: AllocationTimeOff[] = [],
) {
  return buildOrgStatus(staff, roles, openRoles, timeOff, TODAY, WEEK);
}

describe("buildOrgStatus — the payload is a disclosure boundary", () => {
  test("manager-only allocation notes never reach the payload", () => {
    const status = build([person({ allocationNotes: "flight risk" })]);
    // The whole payload is serialized into HTML for every viewer, so assert on the
    // serialized form rather than on a field list that a future spread could widen.
    expect(JSON.stringify(status)).not.toContain("flight risk");
  });

  test("skills are not shipped either — the section never renders them", () => {
    const status = build([
      person({ skills: [{ name: "Haskell", level: 3 }] as never }),
    ]);
    expect(JSON.stringify(status)).not.toContain("Haskell");
  });

  test("a masked leave type is passed through as null, never re-derived", () => {
    const status = build([person()], [], [], [leave({ type: null })]);
    expect(status.leave[0].type).toBeNull();
  });
});

describe("buildOrgStatus — the population", () => {
  test("non-billable staff are excluded, matching buildAvailability", () => {
    const status = build([person({ isBillable: false })]);
    expect(status.people).toHaveLength(0);
  });

  test("week starts are aligned with each person's week loads", () => {
    const status = build([person()]);
    expect(status.weekStarts).toEqual(
      status.people[0].weeks.map((week) => week.weekStart),
    );
  });

  test("today is carried so the UI can label the instant it describes", () => {
    expect(build([person()]).today).toBe(TODAY);
  });

  test("the week columns come from the calendar, not from the population", () => {
    // With nobody billable there is no person to read week starts off, but the
    // availability strip still has five columns to render as empty.
    const empty = build([person({ isBillable: false })]);
    expect(empty.people).toHaveLength(0);
    expect(empty.weekStarts).toEqual(build([person()]).weekStarts);
    expect(empty.weekStarts).toHaveLength(5);
    expect(empty.weekStarts[0]).toBe(WEEK);
  });
});

describe("buildOrgStatus — staffedToday", () => {
  test("a confirmed role spanning today counts", () => {
    const status = build([person()], [role()]);
    expect(status.people[0].staffedToday).toBe(true);
  });

  test("a tentative role does not commit anyone", () => {
    const status = build([person()], [role({ status: "tentative" })]);
    expect(status.people[0].staffedToday).toBe(false);
  });

  test("a role that has not started yet does not count", () => {
    const status = build(
      [person()],
      [role({ startDate: "2026-09-01", endDate: "2026-12-31" })],
    );
    expect(status.people[0].staffedToday).toBe(false);
  });

  test("a role that has already ended does not count", () => {
    const status = build(
      [person()],
      [role({ startDate: "2026-01-01", endDate: "2026-07-01" })],
    );
    expect(status.people[0].staffedToday).toBe(false);
  });

  test("someone on approved leave today is still staffed — allocation, not attendance", () => {
    const status = build(
      [person()],
      [role()],
      [],
      [leave({ startDate: TODAY, endDate: "2026-08-05" })],
    );
    expect(status.people[0].staffedToday).toBe(true);
  });
});

describe("summarizeStaffing", () => {
  test("rate is staffed over headcount", () => {
    const summary = summarizeStaffing([
      orgPerson({ staffedToday: true }),
      orgPerson({ staffId: "staff-2", staffedToday: true }),
      orgPerson({ staffId: "staff-3", staffedToday: false }),
      orgPerson({ staffId: "staff-4", staffedToday: false }),
    ]);
    expect(summary.staffed).toBe(2);
    expect(summary.headcount).toBe(4);
    expect(summary.rate).toBe(0.5);
  });

  test("an empty population yields null rates, never 0%", () => {
    const summary = summarizeStaffing([]);
    expect(summary.rate).toBeNull();
    expect(summary.normalizedRate).toBeNull();
    expect(summary.headcount).toBe(0);
  });

  // The normalized rate's whole point is that its denominator differs from the
  // plain rate's. These cases pin that down, including the two shapes real data
  // rarely produces: nobody full time, and a rate above 100%.
  test("normalized rate divides by full-time headcount, not total headcount", () => {
    const summary = summarizeStaffing([
      orgPerson({ staffedToday: true }),
      orgPerson({
        staffId: "staff-2",
        employmentType: "HOURLY",
        staffedToday: true,
      }),
      orgPerson({
        staffId: "staff-3",
        employmentType: "HOURLY",
        staffedToday: false,
      }),
    ]);
    expect(summary.fullTimeCount).toBe(1);
    expect(summary.rate).toBeCloseTo(2 / 3);
    expect(summary.normalizedRate).toBe(2);
  });

  test("normalized rate is deliberately uncapped above 100%", () => {
    const summary = summarizeStaffing([
      orgPerson({ staffedToday: true }),
      orgPerson({
        staffId: "staff-2",
        employmentType: "HOURLY",
        staffedToday: true,
      }),
    ]);
    expect(summary.normalizedRate).toBeGreaterThan(1);
  });

  test("nobody full time gives null, not a divide-by-zero or a 0", () => {
    const summary = summarizeStaffing([
      orgPerson({ employmentType: "HOURLY", staffedToday: true }),
    ]);
    expect(summary.fullTimeCount).toBe(0);
    expect(summary.normalizedRate).toBeNull();
    // The plain rate is still perfectly well defined.
    expect(summary.rate).toBe(1);
  });

  test("an unrecorded employment type is never counted as full time", () => {
    const summary = summarizeStaffing([
      orgPerson({ employmentType: null, staffedToday: true }),
    ]);
    expect(summary.fullTimeCount).toBe(0);
  });

  test("the by-role breakdown divides within each discipline", () => {
    const summary = summarizeStaffing([
      orgPerson({ role: "ENGINEER", staffedToday: true }),
      orgPerson({ staffId: "s2", role: "ENGINEER", staffedToday: false }),
      orgPerson({ staffId: "s3", role: "DESIGNER", staffedToday: true }),
    ]);
    const engineer = summary.byRole.find((r) => r.role === "ENGINEER");
    const designer = summary.byRole.find((r) => r.role === "DESIGNER");
    expect(engineer).toMatchObject({ staffed: 1, headcount: 2, rate: 0.5 });
    expect(designer).toMatchObject({ staffed: 1, headcount: 1, rate: 1 });
  });

  test("empty discipline rows survive so the table can render an em dash", () => {
    const summary = summarizeStaffing([orgPerson({ role: "ENGINEER" })]);
    const qa = summary.byRole.find((r) => r.role === "QA");
    expect(qa).toMatchObject({ headcount: 0, rate: null });
  });

  test("rows are the delivery disciplines only — no overhead rows", () => {
    const roles = summarizeStaffing([orgPerson()]).byRole.map((r) => r.role);
    expect(roles).toEqual([
      "ENGINEER",
      "DESIGNER",
      "ARCHITECT",
      "DELIVERY",
      "QA",
    ]);
  });

  test("DELIVERY_ROLES is exactly the billable complement — drift guard", () => {
    // If a role is added to the enum, this fails until it's classified either as a
    // delivery discipline here or as overhead in NON_BILLABLE_ROLES.
    const billable = ALL_ROLES.filter((role) => isBillableRole(role));
    expect([...DELIVERY_ROLES].sort()).toEqual([...billable].sort());
  });

  test("OTHER appears only when someone falls outside the delivery disciplines", () => {
    expect(
      summarizeStaffing([orgPerson()]).byRole.some((r) => r.role === "OTHER"),
    ).toBe(false);
    // An overhead discipline carrying billable employment, and no role at all, both
    // land in OTHER rather than vanishing from the breakdown.
    for (const role of ["SALES", null] as const) {
      const summary = summarizeStaffing([orgPerson({ role })]);
      expect(summary.byRole.find((r) => r.role === "OTHER")).toMatchObject({
        headcount: 1,
      });
      // The rows must still account for exactly the overall population.
      const rowTotal = summary.byRole.reduce((n, r) => n + r.headcount, 0);
      expect(rowTotal).toBe(summary.headcount);
    }
  });

  test("no small-cohort suppression — a one-person discipline still reports", () => {
    const summary = summarizeStaffing([
      orgPerson({ role: "QA", staffedToday: true }),
    ]);
    expect(summary.byRole.find((r) => r.role === "QA")?.rate).toBe(1);
  });
});

describe("buildOrgStatus — upcoming roles", () => {
  test("a role starting inside the horizon is listed with days until", () => {
    const status = build(
      [person()],
      [role({ startDate: "2026-08-05", endDate: "2026-12-31" })],
    );
    expect(status.upcomingRoles).toHaveLength(1);
    expect(status.upcomingRoles[0]).toMatchObject({
      kind: "starting",
      inDays: 7,
      staffName: "Ada Lovelace",
    });
  });

  test("a role ending inside the horizon is listed as ending", () => {
    const status = build(
      [person()],
      [role({ startDate: "2026-01-01", endDate: "2026-08-05" })],
    );
    expect(status.upcomingRoles[0]).toMatchObject({
      kind: "ending",
      inDays: 7,
    });
  });

  test("a role beyond the horizon is dropped", () => {
    const status = build(
      [person()],
      [role({ startDate: "2026-10-01", endDate: "2026-12-31" })],
    );
    expect(status.upcomingRoles).toHaveLength(0);
  });

  test("an open position is included, with no person on it", () => {
    const status = build(
      [person()],
      [],
      [openRole({ startDate: "2026-08-05", endDate: "2026-12-31" })],
    );
    expect(status.upcomingRoles[0]).toMatchObject({
      staffId: null,
      staffName: null,
      personLineOfBusiness: null,
      roleType: "ENGINEER",
    });
  });

  test("a short role inside the horizon appears as both starting and ending", () => {
    const status = build(
      [person()],
      [role({ startDate: "2026-08-03", endDate: "2026-08-14" })],
    );
    expect(status.upcomingRoles.map((r) => r.kind)).toEqual([
      "starting",
      "ending",
    ]);
  });

  test("rows are soonest first", () => {
    const status = build(
      [person()],
      [
        role({ id: "later", startDate: "2026-08-20", endDate: "2026-12-31" }),
        role({ id: "sooner", startDate: "2026-08-03", endDate: "2026-12-31" }),
      ],
    );
    expect(status.upcomingRoles.map((r) => r.inDays)).toEqual([5, 22]);
  });
});

describe("buildOrgStatus — borrowed staff", () => {
  test("a person on a role outside their own line of business is borrowed", () => {
    const status = build(
      [person({ lineOfBusiness: "CORE" })],
      [role({ lineOfBusiness: "FINTECH" })],
    );
    expect(status.borrowed[0]).toMatchObject({
      name: "Ada Lovelace",
      homeLineOfBusiness: "CORE",
      roleLineOfBusiness: "FINTECH",
    });
  });

  test("working inside your own line of business is not borrowing", () => {
    const status = build(
      [person({ lineOfBusiness: "CORE" })],
      [role({ lineOfBusiness: "CORE" })],
    );
    expect(status.borrowed).toHaveLength(0);
  });

  test("a tentative cross-LOB booking has not lent anyone yet", () => {
    const status = build(
      [person({ lineOfBusiness: "CORE" })],
      [role({ lineOfBusiness: "FINTECH", status: "tentative" })],
    );
    expect(status.borrowed).toHaveLength(0);
  });

  test("a role not spanning today is not current borrowing", () => {
    const status = build(
      [person({ lineOfBusiness: "CORE" })],
      [
        role({
          lineOfBusiness: "FINTECH",
          startDate: "2026-09-01",
          endDate: "2026-12-31",
        }),
      ],
    );
    expect(status.borrowed).toHaveLength(0);
  });

  test("unknown home line of business is skipped — unknown is not borrowed", () => {
    const status = build(
      [person({ lineOfBusiness: null })],
      [role({ lineOfBusiness: "FINTECH" })],
    );
    expect(status.borrowed).toHaveLength(0);
  });

  test("one person lent to two foreign projects yields two rows", () => {
    const status = build(
      [person({ lineOfBusiness: "CORE" })],
      [
        role({ id: "r1", projectId: "p1", lineOfBusiness: "FINTECH" }),
        role({
          id: "r2",
          projectId: "p2",
          projectName: "Beta",
          lineOfBusiness: "COMMERCE",
        }),
      ],
    );
    expect(status.borrowed).toHaveLength(2);
  });
});

describe("filterByLineOfBusiness", () => {
  const staff = [
    person({ id: "core", name: "Core Person", lineOfBusiness: "CORE" }),
    person({ id: "fin", name: "Fin Person", lineOfBusiness: "FINTECH" }),
  ];

  test("null keeps everyone", () => {
    const status = build(staff);
    expect(filterByLineOfBusiness(status, null).people).toHaveLength(2);
  });

  test("it matches the person's home line of business", () => {
    const status = build(staff);
    const filtered = filterByLineOfBusiness(status, "CORE");
    expect(filtered.people.map((p) => p.staffId)).toEqual(["core"]);
  });

  test("someone lent out still filters under their home line of business", () => {
    // The Core person is working on Fintech work. Filtering to CORE must keep them:
    // the filter is about who they are, not what they happen to be on.
    const status = build(staff, [
      role({ staffId: "core", lineOfBusiness: "FINTECH" }),
    ]);
    const core = filterByLineOfBusiness(status, "CORE");
    expect(core.people.map((p) => p.staffId)).toEqual(["core"]);
    expect(core.borrowed).toHaveLength(1);
    const fintech = filterByLineOfBusiness(status, "FINTECH");
    expect(fintech.borrowed).toHaveLength(0);
  });

  test("an open role falls back to the role's own line of business", () => {
    // It has no holder, so matching on the person would drop every vacancy — the
    // exact rows the panel exists to surface.
    const status = build(
      staff,
      [],
      [
        openRole({
          lineOfBusiness: "FINTECH",
          startDate: "2026-08-05",
          endDate: "2026-12-31",
        }),
      ],
    );
    expect(
      filterByLineOfBusiness(status, "FINTECH").upcomingRoles,
    ).toHaveLength(1);
    expect(filterByLineOfBusiness(status, "CORE").upcomingRoles).toHaveLength(
      0,
    );
  });

  test("leave filters by the absent person's home line of business", () => {
    const status = build(staff, [], [], [leave({ staffId: "fin" })]);
    expect(filterByLineOfBusiness(status, "FINTECH").leave).toHaveLength(1);
    expect(filterByLineOfBusiness(status, "CORE").leave).toHaveLength(0);
  });
});

describe("filterByEmploymentType", () => {
  const people = [
    orgPerson({ staffId: "ft", employmentType: "FULL_TIME" }),
    orgPerson({ staffId: "hr", employmentType: "HOURLY" }),
    orgPerson({ staffId: "unknown", employmentType: null }),
  ];

  test("null keeps everyone", () => {
    expect(filterByEmploymentType(people, null)).toHaveLength(3);
  });

  test("full time excludes hourly and unrecorded alike", () => {
    expect(
      filterByEmploymentType(people, "FULL_TIME").map((p) => p.staffId),
    ).toEqual(["ft"]);
  });

  test("hourly selects only hourly", () => {
    expect(
      filterByEmploymentType(people, "HOURLY").map((p) => p.staffId),
    ).toEqual(["hr"]);
  });
});

describe("buildAvailabilityTabs", () => {
  const WEEKS = ["w0", "w1", "w2", "w3", "w4"];

  /** A person whose free percent per week is given as a list. */
  function freeing(staffId: string, percents: number[]): OrgPerson {
    return orgPerson({
      staffId,
      name: staffId,
      weeks: percents.map((freePercent, i) => ({
        weekStart: WEEKS[i],
        confirmedPercent: 100 - freePercent,
        tentativePercent: 0,
        awayPercent: 0,
        freePercent,
      })),
    });
  }

  test("tab 0 is the bench — everyone free now", () => {
    const tabs = buildAvailabilityTabs(
      [
        freeing("idle", [100, 100, 100, 100, 100]),
        freeing("busy", [0, 0, 0, 0, 0]),
      ],
      WEEKS,
    );
    expect(tabs[0].people.map((p) => p.staffId)).toEqual(["idle"]);
  });

  // The point of the change: later tabs must not re-list the standing bench.
  test("later tabs exclude people who were already free", () => {
    const tabs = buildAvailabilityTabs(
      [freeing("idle", [100, 100, 100, 100, 100])],
      WEEKS,
    );
    expect(tabs[0].people).toHaveLength(1);
    expect(tabs[1].people).toHaveLength(0);
    expect(tabs[4].people).toHaveLength(0);
  });

  test("a person is listed in the week they free up, and only then", () => {
    const tabs = buildAvailabilityTabs(
      [freeing("rolls-off", [0, 0, 100, 100, 100])],
      WEEKS,
    );
    expect(tabs.map((t) => t.people.length)).toEqual([0, 0, 1, 0, 0]);
  });

  test("someone who frees up twice is listed both times", () => {
    // Free now, restaffed, then free again — the second occasion is the one nobody
    // has planned around, so a first-time-only rule would drop exactly the useful row.
    const tabs = buildAvailabilityTabs(
      [freeing("twice", [100, 0, 0, 100, 100])],
      WEEKS,
    );
    expect(tabs.map((t) => t.people.length)).toEqual([1, 0, 0, 1, 0]);
  });

  test("partial freedom below the threshold does not count", () => {
    const tabs = buildAvailabilityTabs(
      [freeing("half", [0, 40, 60, 0, 0])],
      WEEKS,
    );
    expect(tabs[1].people).toHaveLength(0);
    expect(tabs[2].people).toHaveLength(1);
  });

  test("freeFte is total spare capacity, not just the newly free", () => {
    // Deliberately different from people.length: one person is already on the bench
    // and so absent from tab 1's list, but their capacity still exists that week.
    const tabs = buildAvailabilityTabs(
      [
        freeing("idle", [100, 100, 100, 100, 100]),
        freeing("rolls", [0, 100, 100, 100, 100]),
      ],
      WEEKS,
    );
    expect(tabs[1].people.map((p) => p.staffId)).toEqual(["rolls"]);
    expect(tabs[1].freeFte).toBe(2);
  });

  test("listed people are sorted by how free they are, then by name", () => {
    const tabs = buildAvailabilityTabs(
      [
        freeing("a-half", [60, 0, 0, 0, 0]),
        freeing("z-full", [100, 0, 0, 0, 0]),
      ],
      WEEKS,
    );
    expect(tabs[0].people.map((p) => p.staffId)).toEqual(["z-full", "a-half"]);
  });

  test("an empty population still yields one tab per week", () => {
    const tabs = buildAvailabilityTabs([], WEEKS);
    expect(tabs).toHaveLength(5);
    expect(tabs[0]).toMatchObject({
      people: [],
      freeFte: 0,
      tentativeCount: 0,
    });
  });
});

describe("groupRolesByProject", () => {
  function upcoming(overrides: Partial<OrgUpcomingRole> = {}): OrgUpcomingRole {
    return {
      roleId: "r1",
      projectId: "p1",
      projectName: "Acme Rebuild",
      roleType: "ENGINEER",
      roleLineOfBusiness: "CORE",
      staffId: "s1",
      staffName: "Ada",
      personLineOfBusiness: "CORE",
      startDate: "2026-08-10",
      endDate: "2026-12-31",
      kind: "starting",
      inDays: 7,
      ...overrides,
    };
  }

  test("roles on one project collapse into a single group", () => {
    const groups = groupRolesByProject([
      upcoming({ roleId: "a", staffName: "Ada" }),
      upcoming({ roleId: "b", staffName: "Grace" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].roles).toHaveLength(2);
    expect(groups[0].projectName).toBe("Acme Rebuild");
  });

  test("different projects stay separate", () => {
    const groups = groupRolesByProject([
      upcoming({ projectId: "p1", projectName: "Alpha" }),
      upcoming({ projectId: "p2", projectName: "Beta" }),
    ]);
    expect(groups.map((g) => g.projectName)).toEqual(["Alpha", "Beta"]);
  });

  test("a group's inDays is its soonest role", () => {
    const groups = groupRolesByProject([
      upcoming({ roleId: "late", inDays: 20 }),
      upcoming({ roleId: "soon", inDays: 3 }),
    ]);
    expect(groups[0].inDays).toBe(3);
  });

  test("groups are soonest first, and roles within a group too", () => {
    const groups = groupRolesByProject([
      upcoming({ projectId: "p-late", projectName: "Late", inDays: 20 }),
      upcoming({
        projectId: "p-soon",
        projectName: "Soon",
        roleId: "s-late",
        inDays: 9,
      }),
      upcoming({
        projectId: "p-soon",
        projectName: "Soon",
        roleId: "s-soon",
        inDays: 2,
      }),
    ]);
    expect(groups.map((g) => g.projectName)).toEqual(["Soon", "Late"]);
    expect(groups[0].roles.map((r) => r.inDays)).toEqual([2, 9]);
  });

  test("an unfilled seat groups under its project like any other", () => {
    const groups = groupRolesByProject([
      upcoming({ roleId: "open", staffId: null, staffName: null }),
    ]);
    expect(groups[0].roles[0].staffId).toBeNull();
    expect(groups[0].lineOfBusiness).toBe("CORE");
  });

  test("no roles yields no groups", () => {
    expect(groupRolesByProject([])).toEqual([]);
  });
});
