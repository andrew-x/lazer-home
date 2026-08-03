import { describe, expect, test } from "bun:test";
import type { LineOfBusiness } from "@/lib/crm/line-of-business";
import {
  buildUtilizationReport,
  deviates,
  type HoursSeries,
  hoursDeviation,
  type LobHours,
  sumLobAlignment,
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
    canViewLogged: true,
    ...overrides,
  };
}

/** The three full-time split metrics, keyed for direct assertion. */
function splitRows(report: ReturnType<typeof buildUtilizationReport>) {
  const { fullTimeProject, pto, bench } = report.utilization;
  return { project: fullTimeProject, pto, bench };
}

function series(planned: number, confirmed: number | null = null): HoursSeries {
  return {
    planned,
    confirmed,
    variance: confirmed == null ? null : confirmed - planned,
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
    expect(report.staffBreakdown[0].project.plannedShare).toBeNull();
  });
});

describe("the per-day split", () => {
  test("PTO wins over a role covering the same day", () => {
    const pto: UtilizationPtoRecord[] = [
      { staffId: "s1", startDate: "2026-06-01", endDate: "2026-06-05" },
    ];
    const rows = splitRows(
      buildUtilizationReport(inputs({ roles: [role()], pto })),
    );

    // Five PTO days are booked as leave, not as project time, and not as bench.
    expect(rows.pto.hours.planned).toBe(5 * 8);
    expect(rows.project.hours.planned).toBe(17 * 8);
    expect(rows.bench.hours.planned).toBe(0);
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
    const split = splitRows(report);
    const total = [split.project, split.pto, split.bench].reduce(
      (sum, m) => sum + m.hours.planned,
      0,
    );
    expect(total).toBe(FULL_MONTH_HOURS);
  });

  test("over-allocation is not clamped and reads above 100%", () => {
    const report = buildUtilizationReport(
      inputs({
        roles: [
          role({ id: "r1", projectId: "p1" }),
          role({ id: "r2", projectId: "p2" }),
        ],
      }),
    );
    expect(report.utilization.fullTimeProject.hours.planned).toBe(
      FULL_MONTH_HOURS * 2,
    );
    expect(report.utilization.fullTimeProject.plannedShare).toBe(2);
    // Bench stays at zero rather than going negative.
    expect(splitRows(report).bench.hours.planned).toBe(0);
  });

  test("only the roles handed to it count — tentative never reaches the math", () => {
    // Status is no longer part of the projection: `getUtilizationReport` selects
    // confirmed roles only, so anything here is by definition an allocation.
    const report = buildUtilizationReport(inputs({ roles: [role()] }));
    expect(report.roles.activeRoles).toBe(1);
    expect(report.utilization.fullTimeProject.hours.planned).toBe(
      FULL_MONTH_HOURS,
    );
  });
});

describe("the part-time contribution", () => {
  const staff = [
    person({ id: "s1" }),
    person({ id: "s2", name: "Grace Hopper", employmentType: "HOURLY" }),
  ];
  const roles = [
    role({ id: "r1", staffId: "s1", hoursPerDay: 8 }),
    role({ id: "r2", staffId: "s2", hoursPerDay: 4 }),
  ];

  test("hourly project hours are reported apart, as a share of the total", () => {
    const report = buildUtilizationReport(inputs({ staff, roles }));
    expect(report.utilization.fullTimeProject.hours.planned).toBe(
      WORKING_DAYS * 8,
    );
    expect(report.utilization.projectHoursHourly.planned).toBe(
      WORKING_DAYS * 4,
    );
    // 88 of 264 hours.
    expect(report.utilization.hourlyProjectShare.planned).toBeCloseTo(
      1 / 3,
      10,
    );
  });

  test("the split rows stay full-time on both sides of the comparison", () => {
    const entries: UtilizationEntry[] = [
      // The hourly person logs leave and bench time; neither is a full-time
      // measure, so neither lands in the split.
      {
        staffId: "s2",
        date: "2026-06-02",
        projectId: null,
        category: "PTO",
        hours: 8,
      },
      {
        staffId: "s2",
        date: "2026-06-03",
        projectId: null,
        category: "UNALLOCATED_BENCH",
        hours: 8,
      },
    ];
    const rows = splitRows(buildUtilizationReport(inputs({ staff, entries })));
    expect(rows.pto.hours.confirmed).toBe(0);
    expect(rows.bench.hours.confirmed).toBe(0);
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
    expect(report.bench.benchHours.planned).toBe(0);
  });

  test("bench hours carry both series", () => {
    const entries: UtilizationEntry[] = [
      {
        staffId: "s1",
        date: "2026-06-02",
        projectId: null,
        category: "UNALLOCATED_BENCH",
        hours: 8,
      },
    ];
    const report = buildUtilizationReport(inputs({ entries }));
    // Nothing staffed all month, so the whole month is planned bench.
    expect(report.bench.benchHours.planned).toBe(FULL_MONTH_HOURS);
    expect(report.bench.benchHours.confirmed).toBe(8);
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

describe("PTO", () => {
  test("total days clip to the range while record length measures the whole record", () => {
    const report = buildUtilizationReport(
      inputs({
        pto: [
          // Starts before the range: 3 in-range working days, 6 working days long.
          { staffId: "s1", startDate: "2026-05-27", endDate: "2026-06-03" },
        ],
      }),
    );
    expect(report.pto.totalDays).toBe(3);
    expect(report.pto.maxRecordLength).toBe(6);
    expect(report.pto.peopleWithPto).toBe(1);
    expect(report.pto.peopleWithoutPto).toBe(0);
    expect(report.pto.ptoHours.planned).toBe(3 * 8);
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

  test("hourly staff are excluded entirely — PTO is a full-time measure", () => {
    const pto: UtilizationPtoRecord[] = [
      { staffId: "s1", startDate: "2026-06-01", endDate: "2026-06-05" },
    ];
    const report = buildUtilizationReport(
      inputs({ staff: [person({ employmentType: "HOURLY" })], pto }),
    );
    expect(report.pto.totalDays).toBe(0);
    expect(report.pto.peopleWithPto).toBe(0);
    expect(report.pto.peopleWithoutPto).toBe(0);
    expect(report.pto.ptoHours.planned).toBe(0);
    expect(report.pto.maxRecordLength).toBe(0);
  });

  test("an hourly person's row carries no PTO or bench metric at all", () => {
    const report = buildUtilizationReport(
      inputs({ staff: [person({ employmentType: "HOURLY" })] }),
    );
    expect(report.staffBreakdown[0].pto).toBeNull();
    expect(report.staffBreakdown[0].bench).toBeNull();
  });
});

describe("line-of-business alignment", () => {
  /** A person's practice hours on the given basis, as a plain object. */
  function hoursFor(
    report: ReturnType<typeof buildUtilizationReport>,
    staffId: string,
    basis: "planned" | "logged",
  ): LobHours {
    const row = report.lobAlignment.find((r) => r.staffId === staffId);
    if (row == null) throw new Error(`no row for ${staffId}`);
    const hours = basis === "planned" ? row.planned : row.logged;
    if (hours == null) throw new Error("logged hours withheld");
    return hours;
  }

  test("role hours go to the role's practice and bench to the person's own", () => {
    const report = buildUtilizationReport(
      inputs({
        staff: [person({ lineOfBusiness: "CORE" })],
        roles: [role({ lineOfBusiness: "FINTECH", hoursPerDay: 4 })],
      }),
    );
    const planned = hoursFor(report, "s1", "planned");
    // Half of each day is staffed to Fintech; the unstaffed half is bench, which
    // sits with the person's own practice.
    expect(planned.FINTECH).toBe(WORKING_DAYS * 4);
    expect(planned.CORE).toBe(WORKING_DAYS * 4);
    expect(report.lobAlignment[0].plannedTotal).toBe(FULL_MONTH_HOURS);
  });

  test("leave taken while staffed belongs to that project's practice", () => {
    const report = buildUtilizationReport(
      inputs({
        staff: [person({ lineOfBusiness: "DESIGN" })],
        roles: [
          role({
            lineOfBusiness: "FINTECH",
            startDate: "2026-06-01",
            endDate: "2026-06-05",
          }),
        ],
        pto: [
          { staffId: "s1", startDate: "2026-06-01", endDate: "2026-06-05" },
        ],
      }),
    );
    const planned = hoursFor(report, "s1", "planned");
    // The five days of leave land on Fintech, not on the person's own practice;
    // the remaining unstaffed 17 days are bench, which do.
    expect(planned.FINTECH).toBe(5 * 8);
    expect(planned.DESIGN).toBe(17 * 8);
  });

  test("leave taken while unstaffed belongs to the person's own practice", () => {
    const report = buildUtilizationReport(
      inputs({
        staff: [person({ lineOfBusiness: "DESIGN" })],
        pto: [
          { staffId: "s1", startDate: "2026-06-01", endDate: "2026-06-05" },
        ],
      }),
    );
    expect(hoursFor(report, "s1", "planned").DESIGN).toBe(FULL_MONTH_HOURS);
  });

  test("a person's shares total 100% of their attributed hours", () => {
    const report = buildUtilizationReport(
      inputs({
        roles: [
          role({
            lineOfBusiness: "FINTECH",
            startDate: "2026-06-01",
            endDate: "2026-06-05",
          }),
        ],
      }),
    );
    const row = report.lobAlignment[0];
    const total = (Object.keys(row.planned) as LineOfBusiness[]).reduce(
      (sum, lob) => sum + row.planned[lob] / row.plannedTotal,
      0,
    );
    expect(total).toBeCloseTo(1, 10);
  });

  test("logged hours follow the same rule, and internal admin is dropped", () => {
    const entries: UtilizationEntry[] = [
      // Staffed to Fintech on p1.
      {
        staffId: "s1",
        date: "2026-06-02",
        projectId: "p1",
        category: null,
        hours: 6,
      },
      // Leave logged on a day they were staffed → Fintech.
      {
        staffId: "s1",
        date: "2026-06-02",
        projectId: null,
        category: "PTO",
        hours: 2,
      },
      // Bench → their own practice.
      {
        staffId: "s1",
        date: "2026-06-03",
        projectId: null,
        category: "UNALLOCATED_BENCH",
        hours: 4,
      },
      // Overhead belongs to no practice at all.
      {
        staffId: "s1",
        date: "2026-06-03",
        projectId: null,
        category: "INTERNAL_ADMIN",
        hours: 4,
      },
    ];
    const report = buildUtilizationReport(
      inputs({
        staff: [person({ lineOfBusiness: "CORE" })],
        roles: [role({ lineOfBusiness: "FINTECH" })],
        entries,
      }),
    );
    const logged = hoursFor(report, "s1", "logged");
    expect(logged.FINTECH).toBe(8);
    expect(logged.CORE).toBe(4);
    expect(report.lobAlignment[0].loggedTotal).toBe(12);
  });

  test("hours logged against an unstaffed project fall back to the home practice", () => {
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
    expect(hoursFor(report, "s1", "logged").DESIGN).toBe(8);
  });

  test("the cohort total sums only the rows handed to it", () => {
    const report = buildUtilizationReport(
      inputs({
        staff: [
          person({ id: "s1", lineOfBusiness: "CORE" }),
          person({ id: "s2", name: "Grace Hopper", lineOfBusiness: "DESIGN" }),
        ],
      }),
    );
    const all = sumLobAlignment(report.lobAlignment);
    expect(all.plannedTotal).toBe(FULL_MONTH_HOURS * 2);

    const one = sumLobAlignment(
      report.lobAlignment.filter((r) => r.staffId === "s1"),
    );
    expect(one.plannedTotal).toBe(FULL_MONTH_HOURS);
    expect(one.planned.DESIGN).toBe(0);
  });
});

describe("the logged series and its access gate", () => {
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

  test("with access, the cohort is summed and bucketed by target", () => {
    const report = buildUtilizationReport(inputs({ staff, entries }));
    const rows = splitRows(report);
    expect(rows.project.hours.confirmed).toBe(13);
    expect(rows.pto.hours.confirmed).toBe(2);
    expect(rows.bench.hours.confirmed).toBe(8);
    expect(report.utilization.projectHours.variance).toBe(13);
  });

  test("without access every logged figure is null, never zero", () => {
    const report = buildUtilizationReport(
      inputs({ staff, entries, canViewLogged: false }),
    );
    const split = splitRows(report);
    for (const value of [split.project, split.pto, split.bench]) {
      expect(value.hours.confirmed).toBeNull();
      expect(value.confirmedShare).toBeNull();
    }
    expect(report.utilization.projectHours.confirmed).toBeNull();
    expect(report.utilization.projectHours.variance).toBeNull();
    expect(report.utilization.hourlyProjectShare.confirmed).toBeNull();
    expect(report.bench.benchHours.confirmed).toBeNull();
    expect(report.pto.ptoHours.confirmed).toBeNull();
    expect(report.roles.projectsWithLoggedTime).toBeNull();
    expect(report.coverage.canViewLogged).toBe(false);

    const row = report.staffBreakdown[0];
    expect(row.project.hours.confirmed).toBeNull();
    expect(row.project.confirmedShare).toBeNull();
    expect(row.pto?.hours.confirmed).toBeNull();
    expect(row.bench?.hours.confirmed).toBeNull();

    expect(report.lobAlignment[0].logged).toBeNull();
    expect(report.lobAlignment[0].loggedTotal).toBeNull();
  });

  test("no logged hours reads as zero, not as no access", () => {
    const report = buildUtilizationReport(inputs({ staff: [person()] }));
    expect(report.utilization.projectHours.confirmed).toBe(0);
    expect(report.staffBreakdown[0].project.hours.confirmed).toBe(0);
    expect(report.lobAlignment[0].loggedTotal).toBe(0);
  });
});

describe("deviation from plan", () => {
  test("a gap clearing both thresholds is flagged", () => {
    const value = series(100, 70);
    expect(hoursDeviation(value)).toBeCloseTo(-0.3, 10);
    expect(deviates(value)).toBe(true);
  });

  test("a small relative gap is not, however many hours it is", () => {
    // 40 hours out of 1,000 is a lot of hours and 4% of the plan.
    expect(deviates(series(1000, 960))).toBe(false);
  });

  test("a small absolute gap is not, however large the percentage", () => {
    // −25% reads dramatic on a 24-hour plan; it is six hours.
    const value = series(24, 18);
    expect(hoursDeviation(value)).toBeCloseTo(-0.25, 10);
    expect(deviates(value)).toBe(false);
  });

  test("over-delivery is flagged the same way as a shortfall", () => {
    expect(deviates(series(100, 140))).toBe(true);
  });

  test("nothing planned, or nothing readable, is not a deviation", () => {
    expect(hoursDeviation(series(0, 40))).toBeNull();
    expect(deviates(series(0, 40))).toBe(false);
    expect(hoursDeviation(series(100, null))).toBeNull();
    expect(deviates(series(100, null))).toBe(false);
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
