import { describe, expect, test } from "bun:test";
import {
  canonicalCompUnit,
  compUnitText,
  convertCompUnit,
  HOURS_PER_YEAR,
  roundForUnit,
} from "./compensation-unit";

/**
 * The editor's annual/hourly toggle rests on one property: switching units and back
 * must return the identical figure. If it doesn't, clicking an icon twice silently
 * edits someone's compensation — a failure with no visible symptom, which is exactly
 * the kind worth pinning.
 *
 * (ADR 0037: tests are added deliberately. This is the "beyond the type checker"
 * case — the types are satisfied by a drifting implementation.)
 */

describe("compUnitText round trip", () => {
  test("switching units and back returns the identical text", () => {
    // Deliberately includes figures that don't divide evenly by 2080.
    for (const annual of [
      150_000, 95_000, 123_457, 1, 87_333, 250_000, 42_195,
    ]) {
      const asHourly = compUnitText(annual, "ANNUAL", "HOURLY");
      const backToAnnual = compUnitText(annual, "ANNUAL", "ANNUAL");
      expect(backToAnnual).toBe(String(annual));
      // The hourly rendering is a lossy VIEW; the stored figure is untouched.
      expect(Number(asHourly)).toBeCloseTo(annual / HOURS_PER_YEAR, 2);
    }
  });

  test("the naive alternative — re-converting the display — would drift", () => {
    // This is the bug the design avoids, asserted so nobody "simplifies" into it.
    const stored = 150_000;
    const shown = roundForUnit(
      convertCompUnit(stored, "ANNUAL", "HOURLY"),
      "HOURLY",
    );
    const naiveRoundTrip = roundForUnit(
      convertCompUnit(shown, "HOURLY", "ANNUAL"),
      "ANNUAL",
    );
    expect(naiveRoundTrip).not.toBe(stored);
    expect(naiveRoundTrip).toBe(150_010);

    // Deriving from the stored value instead is exact.
    expect(compUnitText(stored, "ANNUAL", "ANNUAL")).toBe("150000");
  });

  test("hourly figures keep cents; annual figures don't", () => {
    expect(compUnitText(72.5, "HOURLY", "HOURLY")).toBe("72.5");
    expect(compUnitText(72.5, "HOURLY", "ANNUAL")).toBe("150800");
    // An annual figure viewed hourly rounds to 2dp, not to a whole dollar.
    expect(compUnitText(150_000, "ANNUAL", "HOURLY")).toBe("72.12");
  });

  test("no stored figure renders as no text", () => {
    expect(compUnitText(null, "ANNUAL", "HOURLY")).toBe("");
  });
});

describe("canonicalCompUnit", () => {
  test("hourly staff are hourly; everyone else, including unknown, is annual", () => {
    expect(canonicalCompUnit("HOURLY")).toBe("HOURLY");
    expect(canonicalCompUnit("FULL_TIME")).toBe("ANNUAL");
    expect(canonicalCompUnit(null)).toBe("ANNUAL");
  });
});

describe("convertCompUnit", () => {
  test("a same-unit conversion is the exact identity", () => {
    // Guards the short-circuit: a round trip through ÷2080 then ×2080 would
    // introduce float noise into a conversion that shouldn't happen at all.
    expect(convertCompUnit(0.1, "HOURLY", "HOURLY")).toBe(0.1);
    expect(convertCompUnit(123_457, "ANNUAL", "ANNUAL")).toBe(123_457);
  });
});
