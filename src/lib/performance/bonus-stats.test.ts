import { describe, expect, test } from "bun:test";
import {
  type BonusStatRow,
  bonusGroupsCovered,
  computeBonusBreakdown,
  computeBonusStats,
} from "./bonus-stats";

/**
 * Invariants the type checker can't express, all of which produce a
 * plausible-looking wrong number rather than an error:
 *
 *  1. A person paid twice must count as ONE recipient. Counting payments as
 *     people inflates "how many people got a bonus" with no visible symptom.
 *  2. The group rows must sum to the overall total, or the footer contradicts the
 *     table above it.
 *  3. Empty groups yield total 0 but a NULL average — never NaN, which would
 *     render as "NaN" in a compensation review.
 */

const row = (
  recipientKey: string,
  group: string,
  amount: number,
): BonusStatRow => ({ recipientKey, group, amount });

describe("computeBonusStats", () => {
  test("counts a twice-paid person as one recipient", () => {
    const stats = computeBonusStats([
      row("ann", "ENGINEER", 1000),
      row("ann", "ENGINEER", 500),
      row("bob", "ENGINEER", 300),
    ]);
    expect(stats.payments).toBe(3);
    expect(stats.recipients).toBe(2);
    expect(stats.total).toBe(1800);
    // Per recipient (1800 / 2), NOT per payment (1800 / 3 = 600).
    expect(stats.avgPerRecipient).toBe(900);
  });

  test("an empty set totals zero with a null average, never NaN", () => {
    const stats = computeBonusStats([]);
    expect(stats).toEqual({
      total: 0,
      payments: 0,
      recipients: 0,
      avgPerRecipient: null,
    });
    expect(Number.isNaN(stats.avgPerRecipient)).toBe(false);
  });
});

describe("computeBonusBreakdown", () => {
  const rows = [
    row("ann", "ENGINEER", 1000),
    row("ann", "ENGINEER", 500),
    row("bob", "DESIGNER", 300),
    row("cat", "QA", 200),
  ];
  const order = ["ENGINEER", "DESIGNER", "LEADERSHIP", "QA"];

  test("group totals sum to the overall total", () => {
    const { overall, groups } = computeBonusBreakdown(rows, order);
    expect(bonusGroupsCovered(rows, order)).toBe(true);
    expect(groups.reduce((sum, g) => sum + g.stats.total, 0)).toBe(
      overall.total,
    );
    expect(overall.total).toBe(2000);
    expect(overall.recipients).toBe(3);
  });

  test("emits groups in the given order and skips empty ones", () => {
    const { groups } = computeBonusBreakdown(rows, order);
    // LEADERSHIP has no payments, so it is absent rather than a zero row.
    expect(groups.map((g) => g.group)).toEqual(["ENGINEER", "DESIGNER", "QA"]);
  });

  test("recipients are counted per group, not carried across groups", () => {
    // The same person paid in two different groups counts once in each and once
    // overall — a distinct-count, not a sum of per-group counts.
    const crossing = [row("ann", "ENGINEER", 100), row("ann", "DESIGNER", 100)];
    const { overall, groups } = computeBonusBreakdown(crossing, order);
    expect(groups.map((g) => g.stats.recipients)).toEqual([1, 1]);
    expect(overall.recipients).toBe(1);
  });

  test("bonusGroupsCovered catches a row outside the axis", () => {
    const stray = [...rows, row("dan", "SALES", 50)];
    expect(bonusGroupsCovered(stray, order)).toBe(false);
    const { overall, groups } = computeBonusBreakdown(stray, order);
    // The stray row lands in `overall` but no group row — which is exactly the
    // discrepancy `bonusGroupsCovered` exists to flag.
    expect(overall.total).toBe(2050);
    expect(groups.reduce((sum, g) => sum + g.stats.total, 0)).toBe(2000);
  });
});
