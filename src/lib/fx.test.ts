import { describe, expect, test } from "bun:test";
import type { Currency } from "./currency";
import { AED_PER_USD, convert, FALLBACK_USD_RATES } from "./fx";

const rates: Record<Currency, number> = {
  USD: 1,
  CAD: 1.4,
  GBP: 0.8,
  EUR: 0.9,
  AED: AED_PER_USD,
};

describe("convert", () => {
  test("returns the amount unchanged for identical currencies", () => {
    expect(convert(100, "USD", "USD", rates)).toBe(100);
    expect(convert(100, "AED", "AED", rates)).toBe(100);
  });

  test("converts via the USD cross-rate", () => {
    expect(convert(100, "USD", "CAD", rates)).toBeCloseTo(140);
    expect(convert(140, "CAD", "USD", rates)).toBeCloseTo(100);
  });

  test("converts AED using the USD peg", () => {
    // 3.6725 AED == 1 USD == 1.4 CAD
    expect(convert(AED_PER_USD, "AED", "USD", rates)).toBeCloseTo(1);
    expect(convert(AED_PER_USD, "AED", "CAD", rates)).toBeCloseTo(1.4);
  });

  test("cross-converts a non-USD pair", () => {
    // 0.8 GBP == 1 USD == 0.9 EUR → 8 GBP == 9 EUR
    expect(convert(8, "GBP", "EUR", rates)).toBeCloseTo(9);
  });
});

describe("FALLBACK_USD_RATES", () => {
  test("covers every supported currency and anchors USD at 1", () => {
    expect(Object.keys(FALLBACK_USD_RATES).sort()).toEqual([
      "AED",
      "CAD",
      "EUR",
      "GBP",
      "USD",
    ]);
    expect(FALLBACK_USD_RATES.USD).toBe(1);
    expect(FALLBACK_USD_RATES.AED).toBe(AED_PER_USD);
  });
});
