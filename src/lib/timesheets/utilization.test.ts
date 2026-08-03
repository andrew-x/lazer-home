import { describe, expect, test } from "bun:test";
import type { AllocationRoleRow } from "@/actions/allocations/getAllocationsGrid";
import {
  allocatedHoursInRange,
  buildPlanRow,
  computeUtilization,
  type HoursRow,
  type PlanRow,
} from "@/lib/timesheets/utilization";

// A single working week: Mon 27 Jul – Sun 2 Aug 2026 (5 weekdays).
const WEEK_FROM = "2026-07-27";
const WEEK_TO = "2026-08-02";

// A year-to-date range: 1 Jan – 2 Aug 2026. 152 Mon–Fri days → 1216h capacity.
const YTD_FROM = "2026-01-01";
const YTD_TO = "2026-08-02";
const YTD_WEEKDAYS = 152;

type RoleInput = Pick<
  AllocationRoleRow,
  "status" | "startDate" | "endDate" | "hoursPerDay"
>;

function role(overrides: Partial<RoleInput> = {}): RoleInput {
  return {
    status: "confirmed",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    hoursPerDay: 8,
    ...overrides,
  };
}

function hours(overrides: Partial<HoursRow> = {}): HoursRow {
  return { projectHours: 0, ptoHours: 0, totalHours: 0, ...overrides };
}

function plan(overrides: Partial<PlanRow> = {}): PlanRow {
  return { allocatedHours: 0, nominalHours: 40, ptoHours: 0, ...overrides };
}

describe("allocatedHoursInRange", () => {
  test("a full-time role spanning a week is 40 hours", () => {
    expect(allocatedHoursInRange(role(), WEEK_FROM, WEEK_TO)).toBe(40);
  });

  test("a half-day role is prorated by hours, not by days", () => {
    expect(
      allocatedHoursInRange(role({ hoursPerDay: 4 }), WEEK_FROM, WEEK_TO),
    ).toBe(20);
  });

  test("a role covering only part of the range contributes proportional hours", () => {
    // Ends Wednesday — Mon, Tue, Wed are the only active weekdays.
    const partial = role({ startDate: "2026-01-01", endDate: "2026-07-29" });
    expect(allocatedHoursInRange(partial, WEEK_FROM, WEEK_TO)).toBe(24);
  });

  test("weekend-only overlap contributes nothing", () => {
    const weekendOnly = role({
      startDate: "2026-08-01",
      endDate: "2026-08-02",
    });
    expect(allocatedHoursInRange(weekendOnly, WEEK_FROM, WEEK_TO)).toBe(0);
  });

  test("a role that ended before the range contributes nothing", () => {
    const past = role({ startDate: "2026-01-01", endDate: "2026-07-24" });
    expect(allocatedHoursInRange(past, WEEK_FROM, WEEK_TO)).toBe(0);
  });

  test("a role running past the range contributes only the elapsed part", () => {
    // Booked all year, but only Jan 1 – Aug 2 has happened.
    expect(allocatedHoursInRange(role(), YTD_FROM, YTD_TO)).toBe(
      YTD_WEEKDAYS * 8,
    );
  });

  test("a role entirely in the future contributes nothing year to date", () => {
    const future = role({ startDate: "2026-11-01", endDate: "2026-12-31" });
    expect(allocatedHoursInRange(future, YTD_FROM, YTD_TO)).toBe(0);
  });
});

describe("buildPlanRow", () => {
  test("tentative roles are excluded — only confirmed work commits a person", () => {
    const row = buildPlanRow(
      [role({ status: "tentative" })],
      [],
      WEEK_FROM,
      WEEK_TO,
    );
    expect(row.allocatedHours).toBe(0);
  });

  test("concurrent confirmed roles sum and are not clamped at full capacity", () => {
    const row = buildPlanRow([role(), role()], [], WEEK_FROM, WEEK_TO);
    expect(row.allocatedHours).toBe(80);
  });

  test("nominal capacity is the range's Mon–Fri days at 8h", () => {
    expect(buildPlanRow([], [], WEEK_FROM, WEEK_TO).nominalHours).toBe(40);
    expect(buildPlanRow([], [], YTD_FROM, YTD_TO).nominalHours).toBe(
      YTD_WEEKDAYS * 8,
    );
  });

  test("approved leave removes capacity in whole working days", () => {
    const row = buildPlanRow(
      [role()],
      [{ startDate: "2026-07-27", endDate: "2026-07-28" }],
      WEEK_FROM,
      WEEK_TO,
    );
    expect(row.nominalHours).toBe(40);
    expect(row.ptoHours).toBe(16);
  });

  test("leave is clamped to the range, so future bookings don't count yet", () => {
    // A week off in November, measured on 2 August.
    const row = buildPlanRow(
      [],
      [{ startDate: "2026-11-02", endDate: "2026-11-06" }],
      YTD_FROM,
      YTD_TO,
    );
    expect(row.ptoHours).toBe(0);
  });

  test("overlapping leave spans are deduped, not double-counted", () => {
    const row = buildPlanRow(
      [],
      [
        { startDate: "2026-07-27", endDate: "2026-07-29" },
        { startDate: "2026-07-28", endDate: "2026-07-30" },
      ],
      WEEK_FROM,
      WEEK_TO,
    );
    expect(row.ptoHours).toBe(32); // Mon–Thu, not 6 days' worth
  });

  test("an inverted range yields an empty plan, never negative capacity", () => {
    expect(buildPlanRow([role()], [], YTD_TO, YTD_FROM)).toEqual({
      allocatedHours: 0,
      nominalHours: 0,
      ptoHours: 0,
    });
  });
});

describe("computeUtilization — actual", () => {
  test("a mid-week partial log reads as a share of what was logged", () => {
    // Logged Mon+Tue only, all billable: 100%, not 40%.
    const summary = computeUtilization(
      [hours({ projectHours: 16, totalHours: 16 })],
      [plan()],
    );
    expect(summary.actual.rate).toBe(1);
  });

  test("bench and admin hours stay in the denominator", () => {
    // 30h project + 10h internal admin.
    const summary = computeUtilization(
      [hours({ projectHours: 30, totalHours: 40 })],
      [plan()],
    );
    expect(summary.actual.rate).toBe(0.75);
  });

  test("PTO comes out of the denominator", () => {
    // 32h project + 8h PTO — a four-day week fully billed is 100%.
    const summary = computeUtilization(
      [hours({ projectHours: 32, ptoHours: 8, totalHours: 40 })],
      [plan()],
    );
    expect(summary.actual.rate).toBe(1);
  });

  test("a full week of PTO contributes 0/0, not 0%", () => {
    const summary = computeUtilization(
      [hours({ ptoHours: 40, totalHours: 40 })],
      [plan()],
    );
    expect(summary.actual.rate).toBeNull();
  });

  test("null hours are absent from the rate, not counted as zero", () => {
    // One person fully billable, one who never logged: 100%, not 50%.
    const summary = computeUtilization(
      [hours({ projectHours: 40, totalHours: 40 }), null],
      [plan(), plan()],
    );
    expect(summary.actual.rate).toBe(1);
  });

  test("aggregation is hours-weighted, not a mean of per-person ratios", () => {
    // 40h@100% and 4h@0%: sum-then-divide gives 40/44 ≈ 0.909, not 0.5.
    const summary = computeUtilization(
      [
        hours({ projectHours: 40, totalHours: 40 }),
        hours({ projectHours: 0, totalHours: 4 }),
      ],
      [plan(), plan()],
    );
    expect(summary.actual.rate).toBeCloseTo(40 / 44, 10);
  });

  test("nobody logged at all yields a null rate", () => {
    expect(
      computeUtilization([null, null], [plan(), plan()]).actual.rate,
    ).toBeNull();
  });
});

describe("computeUtilization — planned", () => {
  test("a full-time person on one full-time role is 100%", () => {
    const summary = computeUtilization([null], [plan({ allocatedHours: 40 })]);
    expect(summary.planned.rate).toBe(1);
  });

  test("over-allocation is reported above 100%, never clamped", () => {
    const summary = computeUtilization([null], [plan({ allocatedHours: 80 })]);
    expect(summary.planned.rate).toBe(2);
  });

  test("approved leave shrinks the denominator so a part week still reads full", () => {
    // Off Mon, allocated the remaining four days.
    const summary = computeUtilization(
      [null],
      [plan({ allocatedHours: 32, ptoHours: 8 })],
    );
    expect(summary.planned.rate).toBe(1);
  });

  test("a week entirely on leave yields a null rate, never a negative one", () => {
    const summary = computeUtilization([null], [plan({ ptoHours: 48 })]);
    expect(summary.planned.rate).toBeNull();
  });

  test("planned counts everyone, including people who never logged time", () => {
    const summary = computeUtilization(
      [null, null],
      [plan({ allocatedHours: 40 }), plan({ allocatedHours: 20 })],
    );
    expect(summary.planned.rate).toBe(60 / 80);
  });
});
