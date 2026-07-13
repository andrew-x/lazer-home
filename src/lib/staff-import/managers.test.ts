import { describe, expect, test } from "bun:test";
import { buildManagerEmailIndex, resolveManager } from "./managers";

describe("buildManagerEmailIndex", () => {
  test("maps normalized email to the set of ripplingIds sharing it", () => {
    const index = buildManagerEmailIndex([
      { email: "Ada@Example.com", ripplingId: "R1" },
      { email: "grace@example.com", ripplingId: "R2" },
    ]);
    expect(index.get("ada@example.com")).toEqual(new Set(["R1"]));
    expect(index.get("grace@example.com")).toEqual(new Set(["R2"]));
  });

  test("the same person from two sources collapses to one ripplingId", () => {
    // e.g. present in both the incoming batch and the DB.
    const index = buildManagerEmailIndex([
      { email: "ada@example.com", ripplingId: "R1" },
      { email: "ada@example.com", ripplingId: "R1" },
    ]);
    expect(index.get("ada@example.com")).toEqual(new Set(["R1"]));
  });

  test("distinct people sharing an email are both recorded (ambiguous)", () => {
    const index = buildManagerEmailIndex([
      { email: "shared@example.com", ripplingId: "R1" },
      { email: "shared@example.com", ripplingId: "R2" },
    ]);
    expect(index.get("shared@example.com")).toEqual(new Set(["R1", "R2"]));
  });
});

describe("resolveManager", () => {
  const index = buildManagerEmailIndex([
    { email: "boss@example.com", ripplingId: "BOSS" },
    { email: "self@example.com", ripplingId: "SELF" },
    { email: "dupe@example.com", ripplingId: "D1" },
    { email: "dupe@example.com", ripplingId: "D2" },
  ]);

  test("no manager email → no manager, no warning", () => {
    expect(
      resolveManager(
        { email: "a@example.com", ripplingId: "A", managerEmail: null },
        index,
      ),
    ).toEqual({ managerRipplingId: null, reason: null });
  });

  test("resolves a manager present in the index", () => {
    expect(
      resolveManager(
        {
          email: "a@example.com",
          ripplingId: "A",
          managerEmail: "boss@example.com",
        },
        index,
      ),
    ).toEqual({ managerRipplingId: "BOSS", reason: null });
  });

  test("matching is case- and whitespace-insensitive", () => {
    expect(
      resolveManager(
        {
          email: "a@example.com",
          ripplingId: "A",
          managerEmail: "  BOSS@Example.com ",
        },
        index,
      ),
    ).toEqual({ managerRipplingId: "BOSS", reason: null });
  });

  test("a manager email matching no staff → not_found", () => {
    expect(
      resolveManager(
        {
          email: "a@example.com",
          ripplingId: "A",
          managerEmail: "ghost@example.com",
        },
        index,
      ),
    ).toEqual({ managerRipplingId: null, reason: "not_found" });
  });

  test("a manager email matching several distinct staff → ambiguous", () => {
    expect(
      resolveManager(
        {
          email: "a@example.com",
          ripplingId: "A",
          managerEmail: "dupe@example.com",
        },
        index,
      ),
    ).toEqual({ managerRipplingId: null, reason: "ambiguous" });
  });

  test("naming one's own email → self", () => {
    expect(
      resolveManager(
        {
          email: "self@example.com",
          ripplingId: "SELF",
          managerEmail: "self@example.com",
        },
        index,
      ),
    ).toEqual({ managerRipplingId: null, reason: "self" });
  });

  test("resolving to one's own ripplingId → self (even via a matched row)", () => {
    // managerEmail differs textually but the only match is the person themselves.
    const idx = buildManagerEmailIndex([
      { email: "me@example.com", ripplingId: "ME" },
    ]);
    expect(
      resolveManager(
        {
          email: "other@example.com",
          ripplingId: "ME",
          managerEmail: "me@example.com",
        },
        idx,
      ),
    ).toEqual({ managerRipplingId: null, reason: "self" });
  });
});
