import { describe, expect, test } from "bun:test";
import {
  type BonusMatrixRow,
  type BonusStatRow,
  bonusGroupsCovered,
  computeBonusBreakdown,
  computeBonusMatrix,
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
 *  4. In a matrix, only MONEY sums to the margins. Recipient counts are distinct
 *     counts, so the cells of a row can legitimately out-count its total.
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

describe("computeBonusMatrix", () => {
  const cell = (
    recipientKey: string,
    matrixRow: string,
    col: string,
    amount: number,
  ): BonusMatrixRow => ({ recipientKey, row: matrixRow, col, amount });

  //                 DISCRETIONARY    SPOT   GIFT
  //   PRODUCT      ann 1000, bob 300  ann 500   —
  //   PLATFORM              —         cat 200  cat 100
  const rows = [
    cell("ann", "PRODUCT", "DISCRETIONARY", 1000),
    cell("ann", "PRODUCT", "SPOT", 500),
    cell("bob", "PRODUCT", "DISCRETIONARY", 300),
    cell("cat", "PLATFORM", "SPOT", 200),
    cell("cat", "PLATFORM", "GIFT", 100),
  ];
  // DATA and INCENTIVE are offered but unpaid, so neither should reach the table.
  const rowOrder = ["PRODUCT", "PLATFORM", "DATA"];
  const colOrder = ["DISCRETIONARY", "SPOT", "INCENTIVE", "GIFT"];

  test("skips empty rows and columns, keeping the given order", () => {
    const matrix = computeBonusMatrix(rows, rowOrder, colOrder);
    expect(matrix.columns).toEqual(["DISCRETIONARY", "SPOT", "GIFT"]);
    expect(matrix.rows.map((r) => r.row)).toEqual(["PRODUCT", "PLATFORM"]);
    // Cells stay index-aligned with `columns`, so the header can't drift.
    for (const r of matrix.rows) {
      expect(r.cells).toHaveLength(matrix.columns.length);
    }
    expect(matrix.columnTotals).toHaveLength(matrix.columns.length);
  });

  test("an unpaid intersection is null, not a zero cell", () => {
    const { columns, rows: matrixRows } = computeBonusMatrix(
      rows,
      rowOrder,
      colOrder,
    );
    const platform = matrixRows[1];
    // PLATFORM paid no discretionary bonus at all — an em dash, not "$0", which
    // would read as "we deliberately paid nothing there".
    expect(platform.cells[columns.indexOf("DISCRETIONARY")]).toBeNull();
    expect(platform.cells[columns.indexOf("SPOT")]?.total).toBe(200);
  });

  test("cell totals sum to both margins, and the margins to the overall", () => {
    const matrix = computeBonusMatrix(rows, rowOrder, colOrder);
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

    // Across each row.
    for (const r of matrix.rows) {
      expect(sum(r.cells.map((c) => c?.total ?? 0))).toBe(r.total.total);
    }
    // Down each column.
    matrix.columns.forEach((_col, index) => {
      expect(sum(matrix.rows.map((r) => r.cells[index]?.total ?? 0))).toBe(
        matrix.columnTotals[index].total,
      );
    });
    // And both margins agree with the grand total behind the stat cards.
    expect(sum(matrix.rows.map((r) => r.total.total))).toBe(
      matrix.overall.total,
    );
    expect(sum(matrix.columnTotals.map((c) => c.total))).toBe(
      matrix.overall.total,
    );
    expect(matrix.overall.total).toBe(2100);
    expect(matrix.overall.payments).toBe(5);
    expect(matrix.overall.recipients).toBe(3);
  });

  test("recipients are distinct per cell and never sum to the margin", () => {
    const matrix = computeBonusMatrix(rows, rowOrder, colOrder);
    const product = matrix.rows[0];
    // ann appears in two of PRODUCT's cells, so the cells count 2 + 1 = 3 while
    // PRODUCT itself paid 2 people. This is correct, and it is why the rendered
    // matrix shows money only.
    expect(product.cells.map((c) => c?.recipients ?? null)).toEqual([
      2,
      1,
      null,
    ]);
    expect(product.total.recipients).toBe(2);
  });

  test("bonusGroupsCovered flags a value outside either dimension", () => {
    const stray = [
      ...rows,
      cell("dan", "SALES", "DISCRETIONARY", 50),
      cell("eve", "PRODUCT", "REFERRAL", 25),
    ];
    const asRows = (pick: (r: BonusMatrixRow) => string) =>
      stray.map((r) => ({ ...r, group: pick(r) }));
    expect(
      bonusGroupsCovered(
        asRows((r) => r.row),
        rowOrder,
      ),
    ).toBe(false);
    expect(
      bonusGroupsCovered(
        asRows((r) => r.col),
        colOrder,
      ),
    ).toBe(false);

    // Same contract as the flat breakdown: strays reach `overall` and no cell.
    const matrix = computeBonusMatrix(stray, rowOrder, colOrder);
    expect(matrix.overall.total).toBe(2175);
    expect(matrix.rows.reduce((s, r) => s + r.total.total, 0)).toBe(2125);
    expect(matrix.columnTotals.reduce((s, c) => s + c.total, 0)).toBe(2150);
  });
});
