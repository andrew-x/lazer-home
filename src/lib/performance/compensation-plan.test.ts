import { describe, expect, test } from "bun:test";
import type { Currency } from "@/lib/format/currency";
import {
  bonusPercent,
  levelTargetGap,
  monthsSince,
  planBonusTotals,
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
 *  5. A discretionary bonus is a LUMP SUM. It must never be restated by the
 *     annual/hourly toggle, and its percentage must divide by ANNUALIZED current
 *     comp — so an hourly and a salaried person on equivalent pay get the same
 *     answer for the same bonus. Getting this wrong is off by 2080×, which reads as
 *     a plausible-looking percentage rather than as an obvious bug.
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

describe("bonusPercent", () => {
  test("divides by current comp", () => {
    expect(
      bonusPercent({
        bonusAmount: 10_000,
        bonusCurrency: "CAD",
        currentAmount: 100_000,
        currentCurrency: "CAD",
        unit: "ANNUAL",
        usdRates: RATES,
      }),
    ).toBeCloseTo(0.1, 10);
  });

  test("annualizes an hourly current figure, so the unit can't move it", () => {
    // An hourly rate that annualizes to exactly 100,000 must give the same 10%.
    const hourly = 100_000 / HOURS_PER_YEAR;
    expect(
      bonusPercent({
        bonusAmount: 10_000,
        bonusCurrency: "CAD",
        currentAmount: hourly,
        currentCurrency: "CAD",
        unit: "HOURLY",
        usdRates: RATES,
      }),
    ).toBeCloseTo(0.1, 10);
  });

  test("cross-rates through USD when the bonus is in another currency", () => {
    // 10,000 USD against 137,000 CAD (= 100,000 USD) is 10%.
    expect(
      bonusPercent({
        bonusAmount: 10_000,
        bonusCurrency: "USD",
        currentAmount: 137_000,
        currentCurrency: "CAD",
        unit: "ANNUAL",
        usdRates: RATES,
      }),
    ).toBeCloseTo(0.1, 10);
  });

  test("null rather than NaN or Infinity for missing or zero inputs", () => {
    const base = {
      bonusCurrency: "CAD" as Currency,
      currentCurrency: "CAD" as Currency,
      unit: "ANNUAL" as const,
      usdRates: RATES,
    };
    expect(
      bonusPercent({ ...base, bonusAmount: null, currentAmount: 100_000 }),
    ).toBeNull();
    expect(
      bonusPercent({ ...base, bonusAmount: 5_000, currentAmount: null }),
    ).toBeNull();
    expect(
      bonusPercent({ ...base, bonusAmount: 5_000, currentAmount: 0 }),
    ).toBeNull();
    expect(
      bonusPercent({
        ...base,
        bonusCurrency: null,
        bonusAmount: 5_000,
        currentAmount: 100_000,
      }),
    ).toBeNull();
  });
});

describe("planBonusTotals", () => {
  const salaried = {
    currentAmount: 100_000,
    currentCurrency: "CAD" as Currency,
    unit: "ANNUAL" as const,
  };

  test("sums mixed currencies into the reporting currency", () => {
    const { total, people } = planBonusTotals({
      rows: [
        { ...salaried, bonusAmount: 10_000, bonusCurrency: "CAD" },
        // 1,000 USD = 1,370 CAD at these rates.
        { ...salaried, bonusAmount: 1_000, bonusCurrency: "USD" },
      ],
      currency: "CAD",
      usdRates: RATES,
    });
    expect(people).toBe(2);
    expect(total).toBeCloseTo(11_370, 6);
  });

  test("counts proposals, not plan membership", () => {
    const { total, people } = planBonusTotals({
      rows: [
        { ...salaried, bonusAmount: 5_000, bonusCurrency: "CAD" },
        { ...salaried, bonusAmount: null, bonusCurrency: "CAD" },
      ],
      currency: "CAD",
      usdRates: RATES,
    });
    expect(people).toBe(1);
    expect(total).toBe(5_000);
  });

  test("percentOfCurrent is a sum over a sum, not a mean of ratios", () => {
    // 10% of 100k and 1% of 1M → the honest cohort figure is 110k/1.1M = 10%,
    // not the 5.5% a mean of the two percentages would give.
    const { percentOfCurrent } = planBonusTotals({
      rows: [
        { ...salaried, bonusAmount: 10_000, bonusCurrency: "CAD" },
        {
          ...salaried,
          currentAmount: 1_000_000,
          bonusAmount: 10_000,
          bonusCurrency: "CAD",
        },
      ],
      currency: "CAD",
      usdRates: RATES,
    });
    expect(percentOfCurrent).toBeCloseTo(20_000 / 1_100_000, 10);
  });

  test("annualizes hourly rows before totalling the denominator", () => {
    const hourly = {
      currentAmount: 100_000 / HOURS_PER_YEAR,
      currentCurrency: "CAD" as Currency,
      unit: "HOURLY" as const,
      bonusAmount: 10_000,
      bonusCurrency: "CAD" as Currency,
    };
    expect(
      planBonusTotals({ rows: [hourly], currency: "CAD", usdRates: RATES })
        .percentOfCurrent,
    ).toBeCloseTo(0.1, 10);
  });

  test("empty and bonus-free plans total zero with no percentage", () => {
    for (const rows of [
      [],
      [{ ...salaried, bonusAmount: null, bonusCurrency: "CAD" as Currency }],
    ]) {
      const totals = planBonusTotals({
        rows,
        currency: "CAD",
        usdRates: RATES,
      });
      expect(totals.total).toBe(0);
      expect(totals.people).toBe(0);
      expect(totals.percentOfCurrent).toBeNull();
    }
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
