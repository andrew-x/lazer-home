/**
 * Annual ↔ hourly compensation, on a fixed company convention. A pure,
 * client-importable module (no `db`/drizzle).
 *
 * A person's compensation is stored as ONE figure whose unit is implied by their
 * employment type — an annual base for `FULL_TIME`, an hourly rate for `HOURLY`
 * (see `currentCompAmount`). That makes the two halves of the roster
 * incomparable on sight, so the editor lets you restate either one in the other's
 * unit. This module owns that transform and nothing else.
 *
 * Deliberately currency-free: FX and unit conversion are independent scalar
 * transforms, and keeping them apart is what makes the percentage columns
 * provably invariant across both toggles. Compose the two where you need both.
 *
 * The conversion is a CONVENTION, not a per-person fact. It uses a flat
 * {@link HOURS_PER_YEAR} rather than scaling by `utilizationTarget`, so the same
 * dollar figure always converts to the same number — a rate you can check in your
 * head, and one that doesn't silently change when someone's target moves.
 */

/** 40 h × 52 w. The one place to change the convention. */
export const HOURS_PER_YEAR = 2080;

/** The unit a compensation figure is denominated in. */
export const COMP_UNITS = ["ANNUAL", "HOURLY"] as const;

export type CompUnit = (typeof COMP_UNITS)[number];

export const COMP_UNIT_LABELS: Record<CompUnit, string> = {
  ANNUAL: "Annual",
  HOURLY: "Hourly",
};

/** Appended after a formatted amount, so an hourly figure can't read as a salary. */
export const COMP_UNIT_SUFFIX: Record<CompUnit, string> = {
  ANNUAL: "",
  HOURLY: "/hr",
};

/**
 * Display precision by unit. Annual figures are whole dollars — cents on a salary
 * are noise. Hourly rates need 2dp, because $72.50/hr rounded to "$73/hr" is a
 * visibly wrong number rather than a tidier one.
 */
export const COMP_UNIT_FRACTION_DIGITS: Record<CompUnit, number> = {
  ANNUAL: 0,
  HOURLY: 2,
};

/**
 * The unit a person's stored figures are in. No employment row → `ANNUAL`, the
 * unit the rest of the app defaults to.
 */
export function canonicalCompUnit(
  employmentType: "FULL_TIME" | "HOURLY" | null,
): CompUnit {
  return employmentType === "HOURLY" ? "HOURLY" : "ANNUAL";
}

/** The other unit — the target of a display toggle. */
export function otherCompUnit(unit: CompUnit): CompUnit {
  return unit === "ANNUAL" ? "HOURLY" : "ANNUAL";
}

/**
 * Restate an amount in another unit. Same unit short-circuits to the identity, so
 * a no-op conversion can never introduce float noise.
 */
export function convertCompUnit(
  amount: number,
  from: CompUnit,
  to: CompUnit,
): number {
  if (from === to) return amount;
  return to === "HOURLY" ? amount / HOURS_PER_YEAR : amount * HOURS_PER_YEAR;
}

/**
 * Round to the precision the unit is stored and shown at. Both results fit
 * `numeric(12, 2)`, so a rounded value round-trips through the database exactly.
 */
export function roundForUnit(amount: number, unit: CompUnit): number {
  return unit === "HOURLY"
    ? Math.round(amount * 100) / 100
    : Math.round(amount);
}

/** Step for a number input in this unit — a meaningful nudge, not one cent. */
export function stepForUnit(unit: CompUnit): number {
  return unit === "HOURLY" ? 0.5 : 1000;
}

/**
 * Render a stored amount as the text of a number input showing it in `unit`.
 *
 * The load-bearing rule for the editor's annual/hourly toggle: the text is always
 * derived from the STORED value, never re-converted from whatever text is currently
 * on screen. Deriving it means switching units and back is exact. Re-converting the
 * display would compound each unit's rounding — 150,000 → "72.12" → 150,010 — and
 * silently move a figure nobody edited.
 */
export function compUnitText(
  amount: number | null,
  from: CompUnit,
  to: CompUnit,
): string {
  if (amount == null) return "";
  return String(roundForUnit(convertCompUnit(amount, from, to), to));
}
