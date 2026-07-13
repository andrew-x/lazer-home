import { describe, expect, test } from "bun:test";
import type { RawRow } from "@/lib/csv-import";
import { transformRows } from "./transform";

/** A complete, importable Rippling row; override individual cells per test. */
function validRawRow(overrides: RawRow = {}): RawRow {
  return {
    "Employee - ID": "R1",
    Employee: "Ada Lovelace",
    "Work email": "ada@example.com",
    "Start date": "2024-01-15",
    "Last day of work": "",
    Department: "Engineering",
    Teams: "Core",
    Title: "Senior Engineer",
    "Employment type name": "Full-time salaried",
    "Annual base remuneration": "150000",
    "Hourly Rate": "0",
    "Target annual bonus": "10000",
    "Compensation currency": "USD",
    ...overrides,
  };
}

describe("transformRows — manager email column handling", () => {
  test("column absent → managerEmail is undefined (import carries no manager info)", () => {
    const { rows, skipped } = transformRows([validRawRow()]);
    expect(skipped).toEqual([]);
    expect(rows[0].managerEmail).toBeUndefined();
  });

  test("column present with a value → managerEmail is that string", () => {
    const { rows } = transformRows([
      validRawRow({ "Manager - Work email": "boss@example.com" }),
    ]);
    expect(rows[0].managerEmail).toBe("boss@example.com");
  });

  test("column present but blank → managerEmail is null (explicit clear)", () => {
    const { rows } = transformRows([
      validRawRow({ "Manager - Work email": "  " }),
    ]);
    expect(rows[0].managerEmail).toBeNull();
  });

  test("column presence is detected regardless of header casing/whitespace", () => {
    const { rows } = transformRows([
      validRawRow({ "  manager - work email ": "boss@example.com" }),
    ]);
    expect(rows[0].managerEmail).toBe("boss@example.com");
  });
});

describe("transformRows — guaranteed bonus", () => {
  test("blank → defaults to 0 (row is kept)", () => {
    const { rows, skipped } = transformRows([
      validRawRow({ "Target annual bonus": "" }),
    ]);
    expect(skipped).toEqual([]);
    expect(rows[0].guaranteedBonus).toBe(0);
  });

  test("whitespace-only → defaults to 0 (row is kept)", () => {
    const { rows, skipped } = transformRows([
      validRawRow({ "Target annual bonus": "   " }),
    ]);
    expect(skipped).toEqual([]);
    expect(rows[0].guaranteedBonus).toBe(0);
  });

  test("a provided value is parsed", () => {
    const { rows } = transformRows([
      validRawRow({ "Target annual bonus": "$12,500.00" }),
    ]);
    expect(rows[0].guaranteedBonus).toBe(12500);
  });

  test("present but unparseable → row is still skipped", () => {
    const { rows, skipped } = transformRows([
      validRawRow({ "Target annual bonus": "n/a" }),
    ]);
    expect(rows).toEqual([]);
    expect(skipped[0].reason).toContain("Target annual bonus");
  });
});
