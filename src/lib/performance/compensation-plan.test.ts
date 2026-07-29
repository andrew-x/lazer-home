import { describe, expect, test } from "bun:test";
import type { Currency } from "@/lib/format/currency";
import {
  levelTargetGap,
  monthsSince,
  planChange,
  raisedFromCurrent,
} from "./compensation-plan";
import { HOURS_PER_YEAR } from "./compensation-unit";

/**
 * Invariants the type checker cannot express, all of which are silently
 * wrong-looking rather than crashing if they break:
 *
 *  1. A percentage column must not move when a *display* toggle does — neither the
 *     display currency nor the annual/hourly unit. A reader comparing two rows
 *     across a toggle has no way to notice a percentage that drifted.
 *  2. Gap % must equal the target increase % minus the proposed change %. It is
 *     computed as one division rather than as that literal subtraction, so the
 *     equality is worth pinning.
 *  3. Every missing or zero input must yield `null`, never NaN or Infinity — the
 *     grid renders an em dash off null, and "NaN%" in a compensation review is
 *     the kind of output that erodes trust in the whole screen.
 *  4. A quick-pick raise must land on the proposal's own currency and the person's
 *     own unit, never on whatever the screen happens to be showing.
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

describe("levelTargetGap", () => {
  // Targets are annual CAD, so a CAD annual row needs no conversion at all —
  // the simplest case to read the algebra off.
  const annualCad = {
    targetAnnual: 130_000,
    unit: "ANNUAL" as const,
    currentAmount: 100_000,
    currentCurrency: "CAD" as Currency,
    plannedAmount: 110_000,
    plannedCurrency: "CAD" as Currency,
    usdRates: RATES,
  };

  test("gap % equals the target increase % minus the proposed change %", () => {
    const gap = levelTargetGap({ ...annualCad, displayCurrency: "CAD" });
    const change = planChange({ ...annualCad, displayCurrency: "CAD" });

    const targetIncrease = 130_000 / 100_000 - 1; // 30%
    expect(change.changePercent).toBeCloseTo(0.1, 12); // 10%

    // The whole point of the column: 30% needed − 10% proposed = 20% short.
    expect(gap.gapPercent).toBeCloseTo(0.2, 12);
    expect(gap.gapPercent).toBeCloseTo(
      targetIncrease - (change.changePercent ?? 0),
      12,
    );
    expect(gap.gapAmount).toBe(20_000);
  });

  test("gap % does not move with the display currency", () => {
    // Target CAD, current CAD, planned USD — all three legs in play.
    const base = {
      ...annualCad,
      plannedAmount: 80_000,
      plannedCurrency: "USD" as Currency,
    };

    const percents = (["CAD", "USD", "EUR"] as const).map(
      (displayCurrency) =>
        levelTargetGap({ ...base, displayCurrency }).gapPercent,
    );

    expect(percents[0]).not.toBeNull();
    expect(percents[1]).toBe(percents[0]);
    expect(percents[2]).toBe(percents[0]);
  });

  test("gap % does not move with the display unit; gap amount scales by 2080", () => {
    // The same person expressed two ways: an annual row, and its exact hourly
    // twin. The percentage must agree; the absolute gap must differ by 2080×.
    const asAnnual = levelTargetGap({ ...annualCad, displayCurrency: "CAD" });
    const asHourly = levelTargetGap({
      ...annualCad,
      unit: "HOURLY",
      currentAmount: 100_000 / HOURS_PER_YEAR,
      plannedAmount: 110_000 / HOURS_PER_YEAR,
      displayCurrency: "CAD",
    });

    expect(asHourly.gapPercent).toBeCloseTo(asAnnual.gapPercent ?? 0, 12);
    expect((asHourly.gapAmount ?? 0) * HOURS_PER_YEAR).toBeCloseTo(
      asAnnual.gapAmount ?? 0,
      6,
    );
    // The annual target restated as an hourly rate.
    expect(asHourly.target).toBeCloseTo(130_000 / HOURS_PER_YEAR, 9);
  });

  test("a proposal above target reads as a negative gap", () => {
    const gap = levelTargetGap({
      ...annualCad,
      plannedAmount: 140_000,
      displayCurrency: "CAD",
    });
    expect(gap.gapAmount).toBe(-10_000);
    expect(gap.gapPercent).toBeCloseTo(-0.1, 12);
  });

  test("missing target, proposal, or baseline yields null, never NaN", () => {
    // No target configured for this role/pool/level.
    const noTarget = levelTargetGap({
      ...annualCad,
      targetAnnual: null,
      displayCurrency: "CAD",
    });
    expect(noTarget).toEqual({
      target: null,
      gapAmount: null,
      gapPercent: null,
    });

    // A target exists but nothing has been proposed yet: the target still shows.
    const noProposal = levelTargetGap({
      ...annualCad,
      plannedAmount: null,
      displayCurrency: "CAD",
    });
    expect(noProposal.target).toBe(130_000);
    expect(noProposal.gapAmount).toBeNull();
    expect(noProposal.gapPercent).toBeNull();

    // Division by zero would be Infinity.
    const zeroBaseline = levelTargetGap({
      ...annualCad,
      currentAmount: 0,
      displayCurrency: "CAD",
    });
    expect(zeroBaseline.gapPercent).toBeNull();
    expect(zeroBaseline.gapAmount).toBe(20_000);
  });
});

describe("raisedFromCurrent", () => {
  test("+0% returns current exactly, and raises round for the unit", () => {
    const base = {
      currentAmount: 150_000,
      currentCurrency: "CAD" as Currency,
      plannedCurrency: "CAD" as Currency,
      usdRates: RATES,
    };

    expect(raisedFromCurrent({ ...base, unit: "ANNUAL", percent: 0 })).toBe(
      150_000,
    );
    expect(raisedFromCurrent({ ...base, unit: "ANNUAL", percent: 0.03 })).toBe(
      154_500,
    );

    // Hourly keeps cents; annual does not.
    expect(
      raisedFromCurrent({
        ...base,
        currentAmount: 72.5,
        unit: "HOURLY",
        percent: 0.03,
      }),
    ).toBe(74.68);
  });

  test("converts into the proposal's currency, not the display currency", () => {
    // 137,000 CAD = 100,000 USD; +5% → 105,000 USD.
    expect(
      raisedFromCurrent({
        currentAmount: 137_000,
        currentCurrency: "CAD",
        plannedCurrency: "USD",
        unit: "ANNUAL",
        percent: 0.05,
        usdRates: RATES,
      }),
    ).toBe(105_000);
  });

  test("null when there is nothing to take a percentage of", () => {
    expect(
      raisedFromCurrent({
        currentAmount: null,
        currentCurrency: null,
        plannedCurrency: "CAD",
        unit: "ANNUAL",
        percent: 0.03,
        usdRates: RATES,
      }),
    ).toBeNull();
    expect(
      raisedFromCurrent({
        currentAmount: 100_000,
        currentCurrency: "CAD",
        plannedCurrency: null,
        unit: "ANNUAL",
        percent: 0.03,
        usdRates: RATES,
      }),
    ).toBeNull();
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
