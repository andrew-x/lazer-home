import { describe, expect, test } from "bun:test";
import {
  changeTone,
  displayedAmount,
  displayedPercent,
  formatChangeAmount,
  formatChangePercent,
  formatUnitMoney,
} from "./plan-format";

/**
 * A difference of zero must not be given a direction.
 *
 * Cross-currency comparison divides and multiplies by FX rates, so "no change" very
 * rarely arrives as exactly 0 — it arrives as -2.9e-11. Signing that produced
 * `−CA$0` and `−0.0%`, and coloured the cell like a pay cut: a movement the reader
 * can see, reason about, and act on, that did not happen.
 */

describe("formatChangeAmount", () => {
  test("zero carries no sign, in either unit", () => {
    expect(formatChangeAmount(0, "CAD", "ANNUAL")).toBe("CA$0");
    expect(formatChangeAmount(0, "CAD", "HOURLY")).toBe("CA$0.00/hr");
  });

  test("float dust below display precision reads as zero, unsigned", () => {
    expect(formatChangeAmount(-2.9e-11, "CAD", "ANNUAL")).toBe("CA$0");
    expect(formatChangeAmount(1e-9, "CAD", "HOURLY")).toBe("CA$0.00/hr");
    // Under half a dollar is not a raise when the column shows whole dollars.
    expect(formatChangeAmount(-0.4, "CAD", "ANNUAL")).toBe("CA$0");
  });

  test("real movements keep their sign, with a true minus", () => {
    expect(formatChangeAmount(8000, "CAD", "ANNUAL")).toBe("+CA$8,000");
    expect(formatChangeAmount(-2500, "CAD", "ANNUAL")).toBe("−CA$2,500");
    expect(formatChangeAmount(-2.5, "CAD", "HOURLY")).toBe("−CA$2.50/hr");
    // U+2212, not a hyphen.
    expect(formatChangeAmount(-1, "CAD", "ANNUAL").startsWith("−")).toBe(true);
  });
});

describe("formatChangePercent", () => {
  test("zero and sub-precision values read as an unsigned 0.0%", () => {
    expect(formatChangePercent(0)).toBe("0.0%");
    expect(formatChangePercent(-1e-12)).toBe("0.0%");
    // 0.04% rounds to 0.0% at one decimal, so it must not be signed either.
    expect(formatChangePercent(0.0004)).toBe("0.0%");
  });

  test("real movements keep their sign", () => {
    expect(formatChangePercent(0.062)).toBe("+6.2%");
    expect(formatChangePercent(-0.1)).toBe("−10.0%");
  });

  test("null is an em dash, never NaN", () => {
    expect(formatChangePercent(null)).toBe("—");
  });
});

describe("tone agrees with the text", () => {
  test("a value that displays as zero is never coloured as a loss", () => {
    // The pairing the cells rely on: round first, then tone the rounded value.
    expect(changeTone(displayedAmount(-2.9e-11, "ANNUAL"))).toBe(
      "text-muted-foreground",
    );
    expect(changeTone(displayedPercent(-1e-12))).toBe("text-muted-foreground");
    // A genuine cut still gets coloured.
    expect(changeTone(displayedAmount(-2500, "ANNUAL"))).toBe(
      "text-destructive",
    );
    expect(changeTone(displayedAmount(null, "ANNUAL"))).toBe(
      "text-muted-foreground",
    );
  });
});

describe("formatUnitMoney", () => {
  test("hourly rates keep cents so they aren't silently a different number", () => {
    // The bug this replaced: 72.50 formatted at 0 digits read as "CA$73/hr".
    expect(formatUnitMoney(72.5, "CAD", "HOURLY")).toBe("CA$72.50/hr");
    expect(formatUnitMoney(150_000, "CAD", "ANNUAL")).toBe("CA$150,000");
  });
});
