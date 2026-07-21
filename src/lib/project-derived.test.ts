import { describe, expect, test } from "bun:test";
import {
  deriveProjectLinesOfBusiness,
  deriveProjectStatus,
} from "@/lib/project-derived";
import {
  PROJECT_ROLE_STATUSES,
  type ProjectRoleStatus,
} from "@/lib/project-role-status";

describe("deriveProjectStatus", () => {
  test("no roles → tentative", () => {
    expect(deriveProjectStatus([])).toBe("tentative");
  });

  test("all roles cancelled → cancelled", () => {
    expect(deriveProjectStatus(["cancelled", "cancelled"])).toBe("cancelled");
  });

  test("any live tentative → tentative (least-committed wins)", () => {
    expect(deriveProjectStatus(["confirmed", "tentative"])).toBe("tentative");
    expect(deriveProjectStatus(["paused", "tentative"])).toBe("tentative");
    expect(deriveProjectStatus(["tentative", "cancelled"])).toBe("tentative");
  });

  test("paused beats confirmed when no tentative", () => {
    expect(deriveProjectStatus(["confirmed", "paused"])).toBe("paused");
    expect(deriveProjectStatus(["paused", "cancelled"])).toBe("paused");
  });

  test("all live roles confirmed → confirmed", () => {
    expect(deriveProjectStatus(["confirmed", "confirmed"])).toBe("confirmed");
    expect(deriveProjectStatus(["confirmed", "cancelled"])).toBe("confirmed");
  });

  test("single role reflects its own status", () => {
    expect(deriveProjectStatus(["confirmed"])).toBe("confirmed");
    expect(deriveProjectStatus(["paused"])).toBe("paused");
  });
});

// LOCKSTEP guard: `isClientExpr` in `src/actions/crm/getCompaniesPage.ts`
// re-expresses "this project is confirmed" in SQL to tag client companies —
// namely, ∃ a confirmed role ∧ ∄ any tentative/paused role (cancelled roles are
// ignored). This encodes that exact boolean rule as a pure predicate and asserts
// it agrees with `deriveProjectStatus(...) === "confirmed"` for every role
// combination, so the two definitions can't silently drift apart.
describe("client/confirmed rule agrees with the getCompaniesPage SQL", () => {
  // Mirror of the `isClientExpr` boolean logic (the SQL, in TS).
  const sqlTreatsAsClientConfirmed = (
    statuses: readonly ProjectRoleStatus[],
  ): boolean =>
    statuses.some((s) => s === "confirmed") &&
    !statuses.some((s) => s === "tentative" || s === "paused");

  // Exhaustively enumerate every role-status combination up to length 3.
  const combinations: ProjectRoleStatus[][] = [[]];
  for (let len = 1; len <= 3; len++) {
    const prev = combinations.filter((c) => c.length === len - 1);
    for (const combo of prev) {
      for (const status of PROJECT_ROLE_STATUSES) {
        combinations.push([...combo, status]);
      }
    }
  }

  test("both rules classify every combination identically", () => {
    for (const statuses of combinations) {
      expect(deriveProjectStatus(statuses) === "confirmed").toBe(
        sqlTreatsAsClientConfirmed(statuses),
      );
    }
  });

  test("spot-check representative combinations", () => {
    // Confirmed (client): at least one confirmed, no tentative/paused.
    expect(deriveProjectStatus(["confirmed"])).toBe("confirmed");
    expect(deriveProjectStatus(["confirmed", "cancelled"])).toBe("confirmed");
    // Not confirmed: a tentative or paused role drops it below confirmed.
    expect(deriveProjectStatus(["confirmed", "tentative"])).not.toBe(
      "confirmed",
    );
    expect(deriveProjectStatus(["confirmed", "paused"])).not.toBe("confirmed");
    // Not confirmed: no confirmed role present at all.
    expect(deriveProjectStatus(["cancelled"])).not.toBe("confirmed");
    expect(deriveProjectStatus([])).not.toBe("confirmed");
  });
});

describe("deriveProjectLinesOfBusiness", () => {
  test("no roles → empty", () => {
    expect(deriveProjectLinesOfBusiness([])).toEqual([]);
  });

  test("dedupes and returns canonical order", () => {
    expect(
      deriveProjectLinesOfBusiness(["FINTECH", "CORE", "FINTECH", "CORPORATE"]),
    ).toEqual(["CORPORATE", "CORE", "FINTECH"]);
  });

  test("single LoB", () => {
    expect(deriveProjectLinesOfBusiness(["DESIGN"])).toEqual(["DESIGN"]);
  });
});
