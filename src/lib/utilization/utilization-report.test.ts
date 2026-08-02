import { describe, expect, test } from "bun:test";
import {
  buildUtilizationReport,
  type UtilizationEntry,
  type UtilizationInputs,
  type UtilizationPtoRecord,
  type UtilizationRole,
  type UtilizationStaff,
  type UtilizationWeek,
} from "./utilization-report";

/**
 * June 2026 runs Mon 1st → Tue 30th and holds exactly 22 working days, so a
 * full-timer's available hours are 22 × 8 = 176. Every expectation below is
 * anchored to that.
 */
const RANGE = { start: "2026-06-01", end: "2026-06-30" };
const WORKING_DAYS = 22;
const FULL_MONTH_HOURS = WORKING_DAYS * 8;

function person(overrides: Partial<UtilizationStaff> = {}): UtilizationStaff {
  return {
    id: "s1",
    name: "Ada Lovelace",
    joinDate: null,
    terminationDate: null,
    lineOfBusiness: "CORE",
    role: "ENGINEER",
    employmentType: "FULL_TIME",
    isBillable: true,
    ...overrides,
  };
}

function role(overrides: Partial<UtilizationRole> = {}): UtilizationRole {
  return {
    id: "r1",
    staffId: "s1",
    projectId: "p1",
    projectName: "Apollo",
    status: "confirmed",
    lineOfBusiness: "CORE",
    startDate: RANGE.start,
    endDate: RANGE.end,
    hoursPerDay: 8,
    ...overrides,
  };
}

function inputs(overrides: Partial<UtilizationInputs> = {}): UtilizationInputs {
  return {
    staff: [person()],
    roles: [],
    pto: [],
    entries: [],
    weeks: [],
    firstRoleStartByStaff: {},
    range: RANGE,
    includeTentative: false,
    confirmedStaffIds: null,
    ...overrides,
  };
}

describe("available hours", () => {
  test("a full-timer employed all month gets every working day", () => {
    const report = buildUtilizationReport(inputs());
    expect(report.utilization.availableHours).toBe(FULL_MONTH_HOURS);
  });

  test("a mid-range joiner only gets the days after they joined", () => {
    // Joining Mon 15 June leaves 12 working days (15–19, 22–26, 29–30).
    const report = buildUtilizationReport(
      inputs({ staff: [person({ joinDate: "2026-06-15" })] }),
    );
    expect(report.utilization.availableHours).toBe(12 * 8);
    expect(report.staffBreakdown[0].availableHours).toBe(12 * 8);
  });

  test("a mid-range departure stops accruing after the termination date", () => {
    // Leaving Fri 12 June leaves 10 working days (1–5, 8–12).
    const report = buildUtilizationReport(
      inputs({ staff: [person({ terminationDate: "2026-06-12" })] }),
    );
    expect(report.utilization.availableHours).toBe(10 * 8);
  });

  test("hourly staff get no denominator but still contribute project hours", () => {
    const report = buildUtilizationReport(
      inputs({
        staff: [person({ employmentType: "HOURLY" })],
        roles: [role({ hoursPerDay: 4 })],
      }),
    );
    expect(report.utilization.availableHours).toBe(0);
    expect(report.utilization.projectHoursHourly.planned).toBe(
      WORKING_DAYS * 4,
    );
    expect(report.utilization.projectHours.planned).toBe(WORKING_DAYS * 4);
    expect(report.staffBreakdown[0].availableHours).toBeNull();
    expect(report.staffBreakdown[0].plannedUtilization).toBeNull();
  });
});

describe("the per-day split", () => {
  test("PTO wins over a role covering the same day", () => {
    const pto: UtilizationPtoRecord[] = [
      { staffId: "s1", startDate: "2026-06-01", endDate: "2026-06-05" },
    ];
    const report = buildUtilizationReport(inputs({ roles: [role()], pto }));
    const rows = Object.fromEntries(
      report.utilization.rows.map((r) => [r.key, r]),
    );

    // Five PTO days are booked as leave, not as project time, and not as bench.
    expect(rows.pto.planned).toBe(5 * 8);
    expect(rows.project.planned).toBe(17 * 8);
    expect(rows.bench.planned).toBe(0);
  });

  test("project + PTO + bench equals available hours when not over-allocated", () => {
    const report = buildUtilizationReport(
      inputs({
        roles: [role({ hoursPerDay: 4 })],
        pto: [
          { staffId: "s1", startDate: "2026-06-08", endDate: "2026-06-09" },
        ],
      }),
    );
    const total = report.utilization.rows
      .filter((r) => r.planned != null)
      .reduce((sum, r) => sum + (r.planned ?? 0), 0);
    expect(total).toBe(FULL_MONTH_HOURS);
  });

  test("over-allocation is not clamped and reads above 100%", () => {
    const report = buildUtilizationReport(
      inputs({
        roles: [
          role({ id: "r1", projectId: "p1" }),
          role({ id: "r2", projectId: "p2", projectName: "Beacon" }),
        ],
      }),
    );
    expect(report.utilization.projectHoursFullTime.planned).toBe(
      FULL_MONTH_HOURS * 2,
    );
    expect(report.utilization.utilization.planned).toBe(2);
    // Bench stays at zero rather than going negative.
    const bench = report.utilization.rows.find((r) => r.key === "bench");
    expect(bench?.planned).toBe(0);
  });
});

describe("bench", () => {
  test("a streak runs across a weekend but not across PTO", () => {
    // Role covers 1–3 June and 15–30, leaving 4, 5, 8, 9, 10, 11, 12 on bench:
    // seven consecutive working days spanning the 6th/7th weekend.
    const roles = [
      role({ id: "r1", startDate: "2026-06-01", endDate: "2026-06-03" }),
      role({ id: "r2", startDate: "2026-06-15", endDate: "2026-06-30" }),
    ];
    const report = buildUtilizationReport(inputs({ roles }));
    expect(report.bench.maxStreak).toBe(7);
    expect(report.bench.staffOverThreshold).toBe(1);

    // One PTO day in the middle splits it into a 3 and a 3.
    const withPto = buildUtilizationReport(
      inputs({
        roles,
        pto: [
          { staffId: "s1", startDate: "2026-06-09", endDate: "2026-06-09" },
        ],
      }),
    );
    expect(withPto.bench.maxStreak).toBe(3);
    expect(withPto.bench.staffOverThreshold).toBe(0);
  });

  test("only full-time billable staff are tracked", () => {
    const report = buildUtilizationReport(
      inputs({ staff: [person({ isBillable: false })] }),
    );
    expect(report.bench.maxBenchDays).toBe(0);
    expect(report.bench.averageBenchDays).toBeNull();
  });

  test("joiner placement measures join date to first role, unplaced counted apart", () => {
    const report = buildUtilizationReport(
      inputs({
        staff: [
          person({ id: "s1", joinDate: "2026-06-01" }),
          person({ id: "s2", name: "Grace Hopper", joinDate: "2026-06-01" }),
        ],
        firstRoleStartByStaff: { s1: "2026-06-11" },
      }),
    );
    expect(report.bench.averageDaysToFirstPlacement).toBe(10);
    expect(report.bench.unplacedJoiners).toBe(1);
  });
});

describe("the forecast toggle", () => {
  const roles = [
    role({ id: "r1", status: "confirmed", hoursPerDay: 4 }),
    role({ id: "r2", status: "tentative", projectId: "p2", hoursPerDay: 4 }),
  ];

  test("tentative roles are excluded by default", () => {
    const report = buildUtilizationReport(inputs({ roles }));
    expect(report.utilization.projectHoursFullTime.planned).toBe(
      WORKING_DAYS * 4,
    );
    expect(report.roles.activeRoles).toBe(1);
  });

  test("turning it on adds them at full weight", () => {
    const report = buildUtilizationReport(
      inputs({ roles, includeTentative: true }),
    );
    expect(report.utilization.projectHoursFullTime.planned).toBe(
      WORKING_DAYS * 8,
    );
    expect(report.roles.activeRoles).toBe(2);
  });

  test("line-of-business alignment ignores it, reading confirmed roles only", () => {
    const split = [
      role({
        id: "r1",
        status: "confirmed",
        lineOfBusiness: "FINTECH",
        startDate: "2026-06-01",
        endDate: "2026-06-05",
      }),
      role({
        id: "r2",
        status: "tentative",
        lineOfBusiness: "COMMERCE",
        startDate: "2026-06-08",
        endDate: "2026-06-30",
      }),
    ];
    const on = buildUtilizationReport(
      inputs({ roles: split, includeTentative: true }),
    );
    const commerce = on.lobAlignment.find(
      (r) => r.lineOfBusiness === "COMMERCE",
    );
    expect(commerce).toBeUndefined();
  });
});

describe("line-of-business alignment", () => {
  test("a confirmed role overrides the home line of business, and shares total 100%", () => {
    const report = buildUtilizationReport(
      inputs({
        staff: [person({ lineOfBusiness: "CORE" })],
        roles: [
          role({
            lineOfBusiness: "FINTECH",
            startDate: "2026-06-01",
            endDate: "2026-06-05",
          }),
        ],
      }),
    );
    const byLob = Object.fromEntries(
      report.lobAlignment.map((r) => [r.lineOfBusiness, r]),
    );
    expect(byLob.FINTECH.plannedDays).toBe(5);
    expect(byLob.CORE.plannedDays).toBe(WORKING_DAYS - 5);

    const total = report.lobAlignment.reduce(
      (sum, r) => sum + r.plannedShare,
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  test("hours logged against an unstaffed project fall back to the home line of business", () => {
    const entries: UtilizationEntry[] = [
      {
        staffId: "s1",
        date: "2026-06-02",
        projectId: "p-unstaffed",
        category: null,
        hours: 8,
      },
    ];
    const report = buildUtilizationReport(
      inputs({
        staff: [person({ lineOfBusiness: "DESIGN" })],
        roles: [role({ lineOfBusiness: "FINTECH" })],
        entries,
      }),
    );
    const design = report.lobAlignment.find(
      (r) => r.lineOfBusiness === "DESIGN",
    );
    expect(design?.confirmedHours).toBe(8);
  });
});

describe("the confirmed series and its access gate", () => {
  const entries: UtilizationEntry[] = [
    {
      staffId: "s1",
      date: "2026-06-02",
      projectId: "p1",
      category: null,
      hours: 6,
    },
    {
      staffId: "s1",
      date: "2026-06-02",
      projectId: null,
      category: "PTO",
      hours: 2,
    },
    {
      staffId: "s2",
      date: "2026-06-02",
      projectId: "p1",
      category: null,
      hours: 7,
    },
    {
      staffId: "s2",
      date: "2026-06-03",
      projectId: null,
      category: "UNALLOCATED_BENCH",
      hours: 8,
    },
  ];
  const staff = [
    person({ id: "s1" }),
    person({ id: "s2", name: "Grace Hopper" }),
  ];

  test("full access sums the cohort and buckets by target", () => {
    const report = buildUtilizationReport(inputs({ staff, entries }));
    const rows = Object.fromEntries(
      report.utilization.rows.map((r) => [r.key, r]),
    );
    expect(rows.project.confirmed).toBe(13);
    expect(rows.pto.confirmed).toBe(2);
    expect(rows.bench.confirmed).toBe(8);
    expect(report.utilization.projectHours.variance).toBe(13);
  });

  test("partial access withholds every cohort total rather than under-reporting", () => {
    const report = buildUtilizationReport(
      inputs({ staff, entries, confirmedStaffIds: ["s1"] }),
    );
    for (const row of report.utilization.rows) {
      expect(row.confirmed).toBeNull();
      expect(row.confirmedShare).toBeNull();
    }
    expect(report.utilization.projectHours.confirmed).toBeNull();
    expect(report.utilization.projectHours.variance).toBeNull();
    expect(report.bench.confirmedBenchHours).toBeNull();
    expect(report.pto.confirmedPtoHours).toBeNull();
    expect(report.roles.projectsWithLoggedTime).toBeNull();
  });

  test("partial access still shows the viewer their own row, and hides the others", () => {
    const report = buildUtilizationReport(
      inputs({ staff, entries, confirmedStaffIds: ["s1"] }),
    );
    const own = report.staffBreakdown.find((r) => r.staffId === "s1");
    const other = report.staffBreakdown.find((r) => r.staffId === "s2");

    expect(own?.hasConfirmedAccess).toBe(true);
    expect(own?.confirmedProjectHours).toBe(6);
    expect(other?.hasConfirmedAccess).toBe(false);
    expect(other?.confirmedProjectHours).toBeNull();
    expect(other?.confirmedUtilization).toBeNull();
  });

  test("no logged hours reads as zero, not as no access", () => {
    const report = buildUtilizationReport(inputs({ staff: [person()] }));
    expect(report.utilization.projectHours.confirmed).toBe(0);
    expect(report.staffBreakdown[0].confirmedProjectHours).toBe(0);
    expect(report.staffBreakdown[0].hasConfirmedAccess).toBe(true);
  });
});

describe("submitted-week coverage", () => {
  test("counts only the employed weeks, and only the submitted ones", () => {
    // June 2026 spans five ISO weeks (Mondays 1, 8, 15, 22, 29).
    const weeks: UtilizationWeek[] = [
      { staffId: "s1", weekStartDate: "2026-06-01", submitted: true },
      { staffId: "s1", weekStartDate: "2026-06-08", submitted: true },
      { staffId: "s1", weekStartDate: "2026-06-15", submitted: false },
    ];
    const report = buildUtilizationReport(inputs({ weeks }));
    expect(report.coverage.weeksTotal).toBe(5);
    expect(report.coverage.weeksSubmitted).toBe(2);
    expect(report.staffBreakdown[0].weeksInRange).toBe(5);
    expect(report.staffBreakdown[0].weeksSubmitted).toBe(2);
  });

  test("weeks before a joiner started are not counted against them", () => {
    const weeks: UtilizationWeek[] = [
      { staffId: "s1", weekStartDate: "2026-06-01", submitted: true },
    ];
    const report = buildUtilizationReport(
      inputs({ staff: [person({ joinDate: "2026-06-15" })], weeks }),
    );
    // Employed for the weeks of the 15th, 22nd and 29th only.
    expect(report.coverage.weeksTotal).toBe(3);
    expect(report.coverage.weeksSubmitted).toBe(0);
  });
});

describe("headcount and roles", () => {
  test("splits full-time from hourly and counts churn inside the range", () => {
    const report = buildUtilizationReport(
      inputs({
        staff: [
          person({ id: "s1", joinDate: "2026-06-03" }),
          person({ id: "s2", name: "B", employmentType: "HOURLY" }),
          person({ id: "s3", name: "C", terminationDate: "2026-06-20" }),
          person({ id: "s4", name: "D", joinDate: "2025-01-01" }),
        ],
      }),
    );
    expect(report.headcount.total).toBe(4);
    expect(report.headcount.fullTime).toBe(3);
    expect(report.headcount.hourly).toBe(1);
    expect(report.headcount.joiners).toBe(1);
    expect(report.headcount.departures).toBe(1);
    expect(report.headcount.byRole[0].role).toBe("ENGINEER");
    expect(report.headcount.byRole[0].total).toBe(4);
  });

  test("role churn, average length and roles per project", () => {
    const report = buildUtilizationReport(
      inputs({
        roles: [
          // Two full working weeks → 10 working days → 2 weeks.
          role({
            id: "r1",
            projectId: "p1",
            startDate: "2026-06-01",
            endDate: "2026-06-12",
          }),
          role({
            id: "r2",
            projectId: "p1",
            startDate: "2026-06-01",
            endDate: "2026-06-12",
          }),
        ],
      }),
    );
    expect(report.roles.activeRoles).toBe(2);
    expect(report.roles.started).toBe(2);
    expect(report.roles.ended).toBe(2);
    expect(report.roles.averageLengthWeeks).toBe(2);
    expect(report.roles.uniqueProjects).toBe(1);
    expect(report.roles.averageRolesPerProject).toBe(2);
  });

  test("a role overlapping only the range edge still counts as active", () => {
    const report = buildUtilizationReport(
      inputs({
        roles: [role({ startDate: "2026-05-01", endDate: "2026-06-02" })],
      }),
    );
    expect(report.roles.activeRoles).toBe(1);
    expect(report.roles.started).toBe(0);
    expect(report.roles.ended).toBe(1);
  });
});

describe("PTO", () => {
  test("total days clip to the range while record length measures the whole record", () => {
    const report = buildUtilizationReport(
      inputs({
        pto: [
          // Starts before the range: 3 in-range working days, 8 working days long.
          {
            staffId: "s1",
            startDate: "2026-05-27",
            endDate: "2026-06-03",
          },
        ],
      }),
    );
    expect(report.pto.totalDays).toBe(3);
    expect(report.pto.maxRecordLength).toBe(6);
    expect(report.pto.peopleWithPto).toBe(1);
    expect(report.pto.peopleWithoutPto).toBe(0);
  });

  test("people who took no leave are counted", () => {
    const report = buildUtilizationReport(
      inputs({
        staff: [person({ id: "s1" }), person({ id: "s2", name: "B" })],
        pto: [
          { staffId: "s1", startDate: "2026-06-01", endDate: "2026-06-01" },
        ],
      }),
    );
    expect(report.pto.peopleWithPto).toBe(1);
    expect(report.pto.peopleWithoutPto).toBe(1);
  });
});
