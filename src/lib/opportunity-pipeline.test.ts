import { describe, expect, test } from "bun:test";
import { OPPORTUNITY_STATUSES } from "@/lib/opportunity";
import {
  computePosition,
  OPPORTUNITY_GROUPS,
  resolveTargetStatus,
} from "./opportunity-pipeline";

describe("opportunity pipeline groups", () => {
  test("flattened groups equal the status enum in order", () => {
    // Importing the module already asserts this at load; assert explicitly too.
    expect(OPPORTUNITY_GROUPS.flatMap((g) => g.statuses)).toEqual([
      ...OPPORTUNITY_STATUSES,
    ]);
  });
});

describe("resolveTargetStatus", () => {
  test("a concrete-status column keeps its own status", () => {
    expect(
      resolveTargetStatus({ kind: "status", status: "scoping" }, "lead"),
    ).toBe("scoping");
  });

  test("collapsed group from earlier in the pipeline → first substatus", () => {
    // lead (group index 1) → scoping (group index 3): earlier → first substatus.
    expect(
      resolveTargetStatus({ kind: "group", groupId: "scoping" }, "lead"),
    ).toBe("scoping_awaiting_info");
  });

  test("collapsed group from later in the pipeline → last substatus", () => {
    // negotiating (index 5) → scoping (index 3): later → last substatus.
    expect(
      resolveTargetStatus({ kind: "group", groupId: "scoping" }, "negotiating"),
    ).toBe("scoping_reviewing");
  });

  test("reordering within the same collapsed group keeps the substatus", () => {
    expect(
      resolveTargetStatus(
        { kind: "group", groupId: "scoping" },
        "scoping_reviewing",
      ),
    ).toBe("scoping_reviewing");
  });

  test("single-status group yields its only status", () => {
    expect(resolveTargetStatus({ kind: "group", groupId: "won" }, "lead")).toBe(
      "closed_won",
    );
  });
});

describe("computePosition", () => {
  test("empty column → 0", () => {
    expect(computePosition(null, null)).toBe(0);
  });

  test("drop at start → before first", () => {
    expect(computePosition(null, 10)).toBe(9);
  });

  test("drop at end → after last", () => {
    expect(computePosition(10, null)).toBe(11);
  });

  test("drop between → midpoint", () => {
    expect(computePosition(10, 20)).toBe(15);
  });
});
