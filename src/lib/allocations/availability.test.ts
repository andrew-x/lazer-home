import { describe, expect, test } from "bun:test";
import type {
  AllocationRoleRow,
  AllocationStaffRow,
  AllocationTimeOff,
} from "@/actions/allocations/getAllocationsGrid";
import {
  AVAILABLE_THRESHOLD_PERCENT,
  buildAvailability,
  buildUpcomingTimeOff,
} from "@/lib/allocations/availability";

// 2026-07-27 is a Monday; the five columns run 27 Jul, 3 / 10 / 17 / 24 Aug.
const WEEK = "2026-07-27";
const WEEK_2 = "2026-08-10"; // index 2
const WEEK_4 = "2026-08-24"; // index 4

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

function leave(overrides: Partial<AllocationTimeOff> = {}): AllocationTimeOff {
  return {
    staffId: "staff-1",
    startDate: "2026-07-27",
    endDate: "2026-07-31",
    type: "VACATION",
    ...overrides,
  };
}

describe("buildAvailability — the population", () => {
  test("non-billable staff are excluded entirely", () => {
    const { people, weeks } = buildAvailability(
      [person({ isBillable: false })],
      [],
      [],
      WEEK,
    );
    expect(people).toHaveLength(0);
    expect(weeks[0].availableCount).toBe(0);
  });

  test("staff with unknown billability are excluded, not assumed billable", () => {
    const { people } = buildAvailability(
      [person({ isBillable: null })],
      [],
      [],
      WEEK,
    );
    expect(people).toHaveLength(0);
  });

  test("the strip always has five columns starting at the given week", () => {
    const { weeks } = buildAvailability([person()], [], [], WEEK);
    expect(weeks.map((w) => w.weekStart)).toEqual([
      "2026-07-27",
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
    ]);
  });
});

describe("buildAvailability — what counts as free", () => {
  test("an unallocated person is free in every week", () => {
    const { people, weeks } = buildAvailability([person()], [], [], WEEK);
    expect(people[0].freeFrom).toBe(WEEK);
    expect(weeks.every((w) => w.availableCount === 1)).toBe(true);
  });

  test("a full-time confirmed role leaves nobody free", () => {
    const { people, weeks } = buildAvailability([person()], [role()], [], WEEK);
    expect(people[0].freeFrom).toBeNull();
    expect(weeks.every((w) => w.availableCount === 0)).toBe(true);
  });

  test("tentative work does not commit a person — they stay free, flagged", () => {
    const { people, weeks } = buildAvailability(
      [person()],
      [role({ status: "tentative" })],
      [],
      WEEK,
    );
    expect(people[0].freeFrom).toBe(WEEK);
    expect(people[0].tentativeOnly).toBe(true);
    expect(weeks[0].availableCount).toBe(1);
    expect(weeks[0].tentativeCount).toBe(1);
  });

  test("a role that ended before the window doesn't make someone tentative-only", () => {
    const { people } = buildAvailability(
      [person()],
      [
        role({
          status: "tentative",
          startDate: "2026-01-01",
          endDate: "2026-06-30",
        }),
      ],
      [],
      WEEK,
    );
    expect(people[0].tentativeOnly).toBe(false);
  });

  test("exactly at the threshold counts as available", () => {
    // 4h/day = 50% confirmed, leaving exactly 50% free.
    const { people } = buildAvailability(
      [person()],
      [role({ hoursPerDay: 4 })],
      [],
      WEEK,
    );
    expect(people[0].weeks[0].freePercent).toBe(AVAILABLE_THRESHOLD_PERCENT);
    expect(people[0].freeFrom).toBe(WEEK);
  });

  test("just under the threshold does not", () => {
    // 5h/day ≈ 63% confirmed → 37% free.
    const { people } = buildAvailability(
      [person()],
      [role({ hoursPerDay: 5 })],
      [],
      WEEK,
    );
    expect(people[0].freeFrom).toBeNull();
  });

  test("approved leave blocks availability even with no allocation", () => {
    const { people, weeks } = buildAvailability(
      [person()],
      [],
      [leave()],
      WEEK,
    );
    expect(people[0].weeks[0].awayPercent).toBe(100);
    expect(people[0].weeks[0].freePercent).toBe(0);
    expect(weeks[0].availableCount).toBe(0);
    // ...but they're free again the following week.
    expect(weeks[1].availableCount).toBe(1);
  });

  test("concurrent full roles never drive free below zero", () => {
    const { people } = buildAvailability(
      [person()],
      [role(), role({ id: "role-2" })],
      [],
      WEEK,
    );
    expect(people[0].weeks[0].freePercent).toBe(0);
  });
});

describe("buildAvailability — buckets and ordering", () => {
  test("someone whose role ends mid-window frees up from the right week", () => {
    // Role ends Friday 7 Aug — week index 1 is partly covered, index 2 is clear.
    const { people, weeks } = buildAvailability(
      [person()],
      [role({ endDate: "2026-08-07" })],
      [],
      WEEK,
    );
    expect(people[0].freeFrom).toBe(WEEK_2);
    expect(weeks[0].availableCount).toBe(0);
    expect(weeks[2].availableCount).toBe(1);
  });

  test("a person free now and again later is counted in every free week", () => {
    // Booked only for weeks 1–3, so free in week 0 and week 4.
    const { people, weeks } = buildAvailability(
      [person()],
      [role({ startDate: "2026-08-03", endDate: "2026-08-21" })],
      [],
      WEEK,
    );
    expect(weeks[0].availableCount).toBe(1);
    expect(weeks[4].availableCount).toBe(1);
    expect(weeks[1].availableCount).toBe(0);
    // ...but keyed to the first free week, so a name list shows them once.
    expect(people[0].freeFrom).toBe(WEEK);
  });

  test("spare capacity is reported in FTE, not just headcount", () => {
    // Two people at 50% free each → 1.0 FTE, not 2.
    const { weeks } = buildAvailability(
      [person(), person({ id: "staff-2", name: "Grace Hopper" })],
      [
        role({ hoursPerDay: 4 }),
        role({ id: "r2", staffId: "staff-2", hoursPerDay: 4 }),
      ],
      [],
      WEEK,
    );
    expect(weeks[0].freeFte).toBeCloseTo(1, 10);
  });

  test("people are sorted soonest-to-free, never-free last, then by name", () => {
    const { people } = buildAvailability(
      [
        person({ id: "booked", name: "Booked Solid" }),
        person({ id: "later", name: "Frees Later" }),
        person({ id: "now-b", name: "Zoe Free" }),
        person({ id: "now-a", name: "Ana Free" }),
      ],
      [
        role({ id: "r1", staffId: "booked" }),
        role({ id: "r2", staffId: "later", endDate: "2026-08-21" }),
      ],
      [],
      WEEK,
    );
    expect(people.map((p) => p.staffId)).toEqual([
      "now-a",
      "now-b",
      "later",
      "booked",
    ]);
    expect(people[2].freeFrom).toBe(WEEK_4);
  });
});

describe("buildUpcomingTimeOff", () => {
  const staff = [person(), person({ id: "staff-2", name: "Grace Hopper" })];

  test("leave beyond the horizon is dropped", () => {
    const rows = buildUpcomingTimeOff(
      staff,
      [leave({ startDate: "2026-09-14", endDate: "2026-09-18" })],
      "2026-08-02",
      30,
    );
    expect(rows).toHaveLength(0);
  });

  test("leave already finished is dropped", () => {
    const rows = buildUpcomingTimeOff(
      staff,
      [leave({ startDate: "2026-07-01", endDate: "2026-07-05" })],
      "2026-08-02",
    );
    expect(rows).toHaveLength(0);
  });

  test("leave under way right now is kept and flagged ongoing", () => {
    const rows = buildUpcomingTimeOff(
      staff,
      [leave({ startDate: "2026-07-30", endDate: "2026-08-05" })],
      "2026-08-02",
    );
    expect(rows[0].ongoing).toBe(true);
    expect(rows[0].startsInDays).toBe(0);
  });

  test("days-until and working-day count come back alongside the real dates", () => {
    const rows = buildUpcomingTimeOff(
      staff,
      [leave({ startDate: "2026-08-10", endDate: "2026-08-14" })],
      "2026-08-02",
    );
    expect(rows[0].startsInDays).toBe(8);
    expect(rows[0].workingDays).toBe(5);
    expect(rows[0].ongoing).toBe(false);
  });

  test("a masked leave type is passed through as null, never re-derived", () => {
    const rows = buildUpcomingTimeOff(
      staff,
      [leave({ startDate: "2026-08-10", endDate: "2026-08-14", type: null })],
      "2026-08-02",
    );
    expect(rows[0].type).toBeNull();
  });

  test("rows are soonest first, ties broken by name", () => {
    const rows = buildUpcomingTimeOff(
      staff,
      [
        leave({
          staffId: "staff-2",
          startDate: "2026-08-10",
          endDate: "2026-08-14",
        }),
        leave({
          staffId: "staff-1",
          startDate: "2026-08-10",
          endDate: "2026-08-14",
        }),
        leave({
          staffId: "staff-1",
          startDate: "2026-08-04",
          endDate: "2026-08-05",
        }),
      ],
      "2026-08-02",
    );
    expect(rows.map((r) => `${r.startDate}/${r.name}`)).toEqual([
      "2026-08-04/Ada Lovelace",
      "2026-08-10/Ada Lovelace",
      "2026-08-10/Grace Hopper",
    ]);
  });

  test("leave for someone not in the staff list is dropped", () => {
    const rows = buildUpcomingTimeOff(
      [person()],
      [
        leave({
          staffId: "ghost",
          startDate: "2026-08-10",
          endDate: "2026-08-14",
        }),
      ],
      "2026-08-02",
    );
    expect(rows).toHaveLength(0);
  });
});
