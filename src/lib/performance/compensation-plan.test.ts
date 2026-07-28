import { describe, expect, test } from "bun:test";
import type { Currency } from "@/lib/format/currency";
import { monthsSince, planChange } from "./compensation-plan";

/**
 * Two invariants the type checker cannot express, both of which are silently
 * wrong-looking rather than crashing if they break:
 *
 *  1. The percentage change must not move when the display-currency toggle does.
 *     A reader comparing two rows across a currency switch has no way to notice
 *     a percentage that drifted.
 *  2. Every missing or zero input must yield `null`, never NaN or Infinity — the
 *     grid renders an em dash off null, and "NaN%" in a compensation review is
 *     the kind of output that erodes trust in the whole screen.
 *
 * (ADR 0037: unit tests are added deliberately, not reflexively. These are the
 * "genuinely beyond the type checker" case it carves out.)
 */

const RATES: Record<Currency, number> = {
  USD: 1,
  CAD: 1.37,
  GBP: 0.79,
  EUR: 0.92,
  AED: 3.6725,
};

describe("planChange", () => {
  test("percentage is identical in every display currency (same-currency row)", () => {
    const base = {
      currentAmount: 150_000,
      currentCurrency: "CAD" as Currency,
      plannedAmount: 165_000,
      plannedCurrency: "CAD" as Currency,
      usdRates: RATES,
    };

    const asDefault = planChange({ ...base, displayCurrency: "CAD" });
    const asUsd = planChange({ ...base, displayCurrency: "USD" });

    expect(asDefault.changePercent).toBeCloseTo(0.1, 12);
    expect(asUsd.changePercent).toBe(asDefault.changePercent);

    // The amounts, by contrast, SHOULD re-denominate.
    expect(asDefault.current).toBe(150_000);
    expect(asUsd.current).toBeCloseTo(150_000 / 1.37, 6);
  });

  test("percentage is identical in every display currency (cross-currency row)", () => {
    // A CAD salary moved onto a USD figure — the case where a naive subtraction
    // of unlike units would produce nonsense.
    const base = {
      currentAmount: 137_000,
      currentCurrency: "CAD" as Currency,
      plannedAmount: 110_000,
      plannedCurrency: "USD" as Currency,
      usdRates: RATES,
    };

    const percents = (["CAD", "USD", "EUR"] as const).map(
      (displayCurrency) =>
        planChange({ ...base, displayCurrency }).changePercent,
    );

    // 137,000 CAD = 100,000 USD, so 110,000 USD is a 10% rise.
    expect(percents[0]).toBeCloseTo(0.1, 12);
    expect(percents[1]).toBe(percents[0]);
    expect(percents[2]).toBe(percents[0]);
  });

  test("change amount converts both legs before subtracting", () => {
    const change = planChange({
      currentAmount: 137_000,
      currentCurrency: "CAD",
      plannedAmount: 110_000,
      plannedCurrency: "USD",
      displayCurrency: "USD",
      usdRates: RATES,
    });

    expect(change.current).toBeCloseTo(100_000, 6);
    expect(change.planned).toBe(110_000);
    expect(change.changeAmount).toBeCloseTo(10_000, 6);
  });

  test("missing or zero inputs yield null, never NaN or Infinity", () => {
    const noEmployment = planChange({
      currentAmount: null,
      currentCurrency: null,
      plannedAmount: 120_000,
      plannedCurrency: "CAD",
      displayCurrency: "CAD",
      usdRates: RATES,
    });
    expect(noEmployment.current).toBeNull();
    expect(noEmployment.changeAmount).toBeNull();
    expect(noEmployment.changePercent).toBeNull();

    const noProposal = planChange({
      currentAmount: 120_000,
      currentCurrency: "CAD",
      plannedAmount: null,
      plannedCurrency: "CAD",
      displayCurrency: "CAD",
      usdRates: RATES,
    });
    expect(noProposal.planned).toBeNull();
    expect(noProposal.changeAmount).toBeNull();
    expect(noProposal.changePercent).toBeNull();

    // Division by zero would be Infinity; it must be null.
    const zeroBaseline = planChange({
      currentAmount: 0,
      currentCurrency: "CAD",
      plannedAmount: 120_000,
      plannedCurrency: "CAD",
      displayCurrency: "CAD",
      usdRates: RATES,
    });
    expect(zeroBaseline.changePercent).toBeNull();
    expect(zeroBaseline.changeAmount).toBe(120_000);

    // No display currency at all (no employment row, no planned currency).
    const nothing = planChange({
      currentAmount: null,
      currentCurrency: null,
      plannedAmount: null,
      plannedCurrency: null,
      displayCurrency: null,
      usdRates: RATES,
    });
    expect(nothing).toEqual({
      current: null,
      planned: null,
      changeAmount: null,
      changePercent: null,
    });
  });

  test("a cut reads as a negative change", () => {
    const change = planChange({
      currentAmount: 100_000,
      currentCurrency: "USD",
      plannedAmount: 90_000,
      plannedCurrency: "USD",
      displayCurrency: "USD",
      usdRates: RATES,
    });
    expect(change.changeAmount).toBe(-10_000);
    expect(change.changePercent).toBeCloseTo(-0.1, 12);
  });
});

describe("monthsSince", () => {
  const now = new Date(2026, 6, 28); // 2026-07-28, local wall clock

  test("counts completed months only", () => {
    expect(monthsSince("2026-01-28", now)).toBe(6);
    // One day short of the sixth anniversary day → still 5 completed months.
    expect(monthsSince("2026-01-29", now)).toBe(5);
  });

  test("spans year boundaries", () => {
    expect(monthsSince("2024-07-28", now)).toBe(24);
  });

  test("null for unknown or future dates", () => {
    expect(monthsSince(null, now)).toBeNull();
    expect(monthsSince("2026-09-01", now)).toBeNull();
  });
});
