import { describe, expect, test } from "bun:test";
import type {
  AllocationStaffRow,
  AllocationTimeOff,
} from "@/actions/allocations/getAllocationsGrid";
import { buildAllocationRows, weekColumnLabel } from "./allocations-grid";

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

describe("buildAllocationRows", () => {
  const person: AllocationStaffRow = {
    id: "staff-1",
    name: "Ada Lovelace",
    lineOfBusiness: null,
    role: null,
    employmentType: "HOURLY",
    skills: [],
    allocationNotes: null,
  };

  test("carries employmentType onto the row", () => {
    const [row] = buildAllocationRows([person], [], [], ["2026-07-06"]);
    expect(row.employmentType).toBe("HOURLY");
  });

  test("carries allocationNotes onto the row", () => {
    const [row] = buildAllocationRows(
      [{ ...person, allocationNotes: "On bench after Aug 15" }],
      [],
      [],
      ["2026-07-06"],
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
    const [row] = buildAllocationRows([person], [], [timeOff], ["2026-07-06"]);
    expect(row.weeks[0].timeOff).toMatchObject({
      startDate: "2026-07-07",
      endDate: "2026-07-09",
    });
  });

  test("a week with no time off has a null timeOff cell", () => {
    const [row] = buildAllocationRows([person], [], [], ["2026-07-06"]);
    expect(row.weeks[0].timeOff).toBeNull();
  });
});
