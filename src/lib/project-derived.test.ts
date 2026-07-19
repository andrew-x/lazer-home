import { describe, expect, test } from "bun:test";
import {
  deriveProjectLinesOfBusiness,
  deriveProjectStatus,
} from "@/lib/project-derived";

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
