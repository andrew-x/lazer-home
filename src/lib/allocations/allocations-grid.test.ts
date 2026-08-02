import { describe, expect, test } from "bun:test";
import type {
  AllocationRoleRow,
  AllocationStaffRow,
  AllocationTimeOff,
} from "@/actions/allocations/getAllocationsGrid";
import {
  bucketLoadPercent,
  bucketPercent,
  buildAllocationRows,
  columnLabel,
  weekColumnLabel,
} from "./allocations-grid";

describe("weekColumnLabel", () => {
  test("same-month working week collapses the month", () => {
    // 2026-07-06 is a Monday; its Friday is 2026-07-10.
    expect(weekColumnLabel("2026-07-06")).toBe("Jul 6–10");
  });

  test("cross-month working week spells both months", () => {
    // 2026-06-29 (Mon) → 2026-07-03 (Fri) straddles the month boundary.
    expect(weekColumnLabel("2026-06-29")).toBe("Jun 29–Jul 3");
  });
});

describe("columnLabel", () => {
  test("day columns read as weekday + date", () => {
    expect(columnLabel("day", "2026-07-06")).toBe("Mon, Jul 6");
  });

  test("week columns reuse the working-week label", () => {
    expect(columnLabel("week", "2026-07-06")).toBe("Jul 6–10");
  });

  test("month columns read as month + year", () => {
    expect(columnLabel("month", "2026-07-01")).toBe("Jul 2026");
  });
});

describe("bucketPercent", () => {
  // A full-time role across one working week (Mon–Fri).
  const role = {
    startDate: "2026-07-06",
    endDate: "2026-07-10",
    hoursPerDay: 8,
  };
  // A half-day (4h) role over the same span.
  const halfDay = { ...role, hoursPerDay: 4 };

  test("a weekday in range shows the nominal rate at day granularity", () => {
    expect(bucketPercent(role, "day", "2026-07-06")).toBe(100);
    expect(bucketPercent(halfDay, "day", "2026-07-06")).toBe(50);
  });

  test("a weekend day is empty even mid-span", () => {
    // 2026-07-11 is a Saturday.
    expect(bucketPercent(role, "day", "2026-07-11")).toBe(0);
  });

  test("a day outside the role's span is empty", () => {
    expect(bucketPercent(role, "day", "2026-07-13")).toBe(0);
  });

  test("weeks prorate their partial start/end columns", () => {
    // Role ends Tue 2026-07-07: only Mon+Tue active → 2/5 of a 40h week → 40%.
    const shortWeek = { ...role, endDate: "2026-07-07" };
    expect(bucketPercent(shortWeek, "week", "2026-07-06")).toBe(40);
  });

  test("months show the flat rate, not a working-days average", () => {
    // Active only Mon+Tue of July, but the month still reads the nominal rate.
    const twoDays = { ...role, endDate: "2026-07-07" };
    expect(bucketPercent(twoDays, "month", "2026-07-01")).toBe(100);
  });

  test("a month the role never touches is empty", () => {
    expect(bucketPercent(role, "month", "2026-09-01")).toBe(0);
  });
});

describe("bucketLoadPercent", () => {
  const role = {
    startDate: "2026-07-06",
    endDate: "2026-07-10",
    hoursPerDay: 8,
  };

  test("matches the displayed rate at day granularity", () => {
    expect(bucketLoadPercent(role, "day", "2026-07-06")).toBe(100);
    expect(
      bucketLoadPercent({ ...role, hoursPerDay: 4 }, "day", "2026-07-06"),
    ).toBe(50);
  });

  test("matches the displayed rate at week granularity, edges included", () => {
    // Ends Tue: 2 of 5 weekdays → 40%, same as bucketPercent.
    const shortWeek = { ...role, endDate: "2026-07-07" };
    expect(bucketLoadPercent(shortWeek, "week", "2026-07-06")).toBe(40);
    expect(bucketLoadPercent(role, "week", "2026-07-06")).toBe(100);
  });

  test("prorates at month granularity where the displayed rate does not", () => {
    // Active Mon+Tue of a 23-working-day July. The block still reads 100% (a
    // rate); the load it actually consumes is 2/23.
    const twoDays = { ...role, endDate: "2026-07-07" };
    expect(bucketPercent(twoDays, "month", "2026-07-01")).toBe(100);
    expect(bucketLoadPercent(twoDays, "month", "2026-07-01")).toBeCloseTo(
      (2 / 23) * 100,
      6,
    );
  });

  test("is uncapped where the displayed rate is capped", () => {
    const overloaded = { ...role, hoursPerDay: 12 };
    expect(bucketPercent(overloaded, "day", "2026-07-06")).toBe(100);
    expect(bucketLoadPercent(overloaded, "day", "2026-07-06")).toBe(150);
  });

  test("a weekend day carries no load", () => {
    expect(bucketLoadPercent(role, "day", "2026-07-11")).toBe(0);
  });
});

describe("buildAllocationRows", () => {
  const person: AllocationStaffRow = {
    id: "staff-1",
    name: "Ada Lovelace",
    lineOfBusiness: null,
    role: null,
    employmentType: "HOURLY",
    isBillable: true,
    skills: [],
    allocationNotes: null,
  };

  const role: AllocationRoleRow = {
    id: "role-1",
    staffId: "staff-1",
    projectId: "project-1",
    projectName: "Apollo",
    roleType: "ENGINEER",
    status: "confirmed",
    lineOfBusiness: "CORE",
    description: null,
    startDate: "2026-07-06",
    endDate: "2026-07-10",
    hoursPerDay: 8,
  };

  test("carries employmentType onto the row", () => {
    const [row] = buildAllocationRows([person], [], [], ["2026-07-06"], "week");
    expect(row.employmentType).toBe("HOURLY");
  });

  test("carries allocationNotes onto the row", () => {
    const [row] = buildAllocationRows(
      [{ ...person, allocationNotes: "On bench after Aug 15" }],
      [],
      [],
      ["2026-07-06"],
      "week",
    );
    expect(row.allocationNotes).toBe("On bench after Aug 15");
  });

  test("an away week carries the overlapping span's start/end dates", () => {
    const timeOff: AllocationTimeOff = {
      staffId: "staff-1",
      startDate: "2026-07-07",
      endDate: "2026-07-09",
      type: "VACATION",
    };
    const [row] = buildAllocationRows(
      [person],
      [],
      [timeOff],
      ["2026-07-06"],
      "week",
    );
    expect(row.cells[0].timeOff).toMatchObject({
      startDate: "2026-07-07",
      endDate: "2026-07-09",
    });
  });

  test("a week with no time off has a null timeOff cell", () => {
    const [row] = buildAllocationRows([person], [], [], ["2026-07-06"], "week");
    expect(row.cells[0].timeOff).toBeNull();
  });

  test("day columns mark the role's start and leave weekends empty", () => {
    const columns = ["2026-07-06", "2026-07-11"]; // Monday, then Saturday.
    const [row] = buildAllocationRows([person], [role], [], columns, "day");
    expect(row.cells[0].allocations).toHaveLength(1);
    expect(row.cells[0].allocations[0]).toMatchObject({
      percent: 100,
      isStart: true,
    });
    expect(row.cells[1].allocations).toHaveLength(0);
  });

  test("month columns mark start & end on the containing month", () => {
    const [row] = buildAllocationRows(
      [person],
      [role],
      [],
      ["2026-07-01"],
      "month",
    );
    expect(row.cells[0].allocations[0]).toMatchObject({
      percent: 100,
      isStart: true,
      isEnd: true,
    });
  });

  test("time off prorates over the month's working days", () => {
    // Three away weekdays in a 23-working-day July → round(3/23·100) = 13%.
    const timeOff: AllocationTimeOff = {
      staffId: "staff-1",
      startDate: "2026-07-07",
      endDate: "2026-07-09",
      type: "VACATION",
    };
    const [row] = buildAllocationRows(
      [person],
      [],
      [timeOff],
      ["2026-07-01"],
      "month",
    );
    expect(row.cells[0].timeOff?.percent).toBe(13);
  });

  describe("capacity", () => {
    test("nobody booked reads as fully free", () => {
      const [row] = buildAllocationRows(
        [person],
        [],
        [],
        ["2026-07-06"],
        "week",
      );
      expect(row.cells[0].capacity).toMatchObject({
        loadPercent: 0,
        awayPercent: 0,
        freePercent: 100,
        overPercent: 0,
      });
    });

    test("a weekend column has no capacity to report", () => {
      // 2026-07-11 is a Saturday — zero working days, so no meter at all.
      const [row] = buildAllocationRows(
        [person],
        [role],
        [],
        ["2026-07-11"],
        "day",
      );
      expect(row.cells[0].capacity).toBeNull();
    });

    test("tentative work consumes capacity alongside confirmed", () => {
      const tentative: AllocationRoleRow = {
        ...role,
        id: "role-2",
        projectId: "project-2",
        projectName: "Gemini",
        status: "tentative",
        hoursPerDay: 2,
      };
      const [row] = buildAllocationRows(
        [person],
        [{ ...role, hoursPerDay: 4 }, tentative],
        [],
        ["2026-07-06"],
        "week",
      );
      expect(row.cells[0].capacity).toMatchObject({
        confirmedPercent: 50,
        tentativePercent: 25,
        loadPercent: 75,
        freePercent: 25,
        overPercent: 0,
      });
    });

    test("time off nets out of capacity rather than sitting beside it", () => {
      // Away Tue–Wed (2 of 5 weekdays → 40%) with a 4h/day role (50%).
      const timeOff: AllocationTimeOff = {
        staffId: "staff-1",
        startDate: "2026-07-07",
        endDate: "2026-07-08",
        type: "VACATION",
      };
      const [row] = buildAllocationRows(
        [person],
        [{ ...role, hoursPerDay: 4 }],
        [timeOff],
        ["2026-07-06"],
        "week",
      );
      expect(row.cells[0].capacity).toMatchObject({
        loadPercent: 50,
        awayPercent: 40,
        freePercent: 10,
        overPercent: 0,
      });
    });

    test("booked while fully away reads as over-allocated", () => {
      const timeOff: AllocationTimeOff = {
        staffId: "staff-1",
        startDate: "2026-07-06",
        endDate: "2026-07-10",
        type: "VACATION",
      };
      const [row] = buildAllocationRows(
        [person],
        [role],
        [timeOff],
        ["2026-07-06"],
        "week",
      );
      expect(row.cells[0].capacity).toMatchObject({
        loadPercent: 100,
        awayPercent: 100,
        freePercent: 0,
        overPercent: 100,
      });
    });

    test("two overlapping full-time roles read as 100% over", () => {
      const second: AllocationRoleRow = {
        ...role,
        id: "role-2",
        projectId: "project-2",
        projectName: "Gemini",
      };
      const [row] = buildAllocationRows(
        [person],
        [role, second],
        [],
        ["2026-07-06"],
        "week",
      );
      expect(row.cells[0].capacity).toMatchObject({
        freePercent: 0,
        overPercent: 100,
      });
    });

    test("back-to-back half-month roles fill a month exactly, not twice over", () => {
      // The case the prorated load figure exists for: both blocks display their
      // nominal 100% rate, but together they consume exactly one person-month.
      const firstHalf: AllocationRoleRow = {
        ...role,
        startDate: "2026-07-01",
        endDate: "2026-07-15",
      };
      const secondHalf: AllocationRoleRow = {
        ...role,
        id: "role-2",
        projectId: "project-2",
        projectName: "Gemini",
        startDate: "2026-07-16",
        endDate: "2026-07-31",
      };
      const [row] = buildAllocationRows(
        [person],
        [firstHalf, secondHalf],
        [],
        ["2026-07-01"],
        "month",
      );
      expect(row.cells[0].allocations.map((a) => a.percent)).toEqual([
        100, 100,
      ]);
      expect(row.cells[0].capacity).toMatchObject({
        loadPercent: 100,
        freePercent: 0,
        overPercent: 0,
      });
    });

    test("thirds sum to full, not one point over", () => {
      // Rounding each share first would give 33+33+33 = 99 (or 34×3 = 102).
      const third = 8 / 3;
      const roles: AllocationRoleRow[] = [1, 2, 3].map((n) => ({
        ...role,
        id: `role-${n}`,
        projectId: `project-${n}`,
        hoursPerDay: third,
      }));
      const [row] = buildAllocationRows(
        [person],
        roles,
        [],
        ["2026-07-06"],
        "week",
      );
      expect(row.cells[0].capacity).toMatchObject({
        loadPercent: 100,
        freePercent: 0,
        overPercent: 0,
      });
    });
  });
});
