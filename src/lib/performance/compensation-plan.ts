/**
 * Compensation change plans — the pure, client-importable core (no `db`/drizzle).
 *
 * A plan is a named, effective-dated *proposal*: a cohort of staff, each with a
 * proposed rating and a proposed compensation figure, plus the workflow state of
 * the review conversation. Committing a plan writes the ratings as each person's
 * latest rating; it deliberately does NOT write compensation — Rippling remains
 * the sole writer of `staffEmployment` (ADR 0020). A committed plan instead keeps
 * comparing its proposal against live comp so unapplied changes are visible.
 *
 * This module owns the status tuple (feeding the pgEnum, per ADR 0016) and the
 * display math the editor runs per row. Both live here rather than in a component
 * so the server read, the grid, and the tests share one implementation.
 */

import type { PermissionCheck } from "@/lib/auth/permissions";
import type { Currency } from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";
import {
  COMP_TARGET_CURRENCY,
  COMP_TARGET_UNIT,
} from "@/lib/performance/compensation-targets";
import {
  type CompUnit,
  convertCompUnit,
  roundForUnit,
} from "@/lib/performance/compensation-unit";

/**
 * The gate on every compensation-plan surface — read, write and nav alike.
 *
 * Requires BOTH capabilities, which Better Auth's `authorize` ANDs across
 * resources, so this is a genuine conjunction: `finance` (compensation but not
 * ratings) is denied, leaving manager/admin. A plan joins compensation to
 * ratings, so it inherits the stricter of the two gates — and unlike the
 * aggregate dashboard reads, its rows are identity-bearing.
 *
 * Defined once here so the actions, both pages, and the nav entry can never
 * drift apart. It is a request against the existing matrix, not a new capability
 * — `permissions.ts` remains the only place access-control logic lives.
 */
export const COMPENSATION_PLAN_ACCESS: PermissionCheck = {
  staff: ["viewCompensation"],
  ratings: ["edit"],
};

/**
 * The rejection a write gets once a plan is committed. Shared verbatim so the
 * editor can recognise *this* failure — where retrying is pointless and the right
 * response is to stop saving and re-render read-only — apart from an ordinary
 * network error, where retrying is exactly right.
 */
export const PLAN_LOCKED_MESSAGE =
  "This plan has been committed and can no longer be edited.";

export const COMPENSATION_PLAN_STATUSES = ["DRAFT", "COMMITTED"] as const;

export type CompensationPlanStatus =
  (typeof COMPENSATION_PLAN_STATUSES)[number];

export const COMPENSATION_PLAN_STATUS_LABELS: Record<
  CompensationPlanStatus,
  string
> = {
  DRAFT: "Draft",
  COMMITTED: "Committed",
};

/**
 * How far the review conversation has got for one person, as a single ordered
 * ladder rather than a set of independent flags.
 *
 * This replaced three booleans (`ratingDone`/`meetingDone`/`isComplete`). They
 * were never actually independent: you cannot meaningfully finish a review you
 * never rated, and "complete without a rating" was representable but nonsense.
 * One exclusive column makes the nonsense states unrepresentable instead of
 * merely discouraged, and costs one table column instead of three.
 *
 * Low → high, so the tuple order IS the progression — {@link planItemStatusRank}
 * and the sort comparator both read it that way.
 */
export const COMPENSATION_PLAN_ITEM_STATUSES = [
  "NOT_STARTED",
  "RATING_DONE",
  "MEETING_DONE",
  "COMPLETE",
] as const;

export type CompensationPlanItemStatus =
  (typeof COMPENSATION_PLAN_ITEM_STATUSES)[number];

/** Full labels — accessible names, read-only badges, dialog copy. */
export const COMPENSATION_PLAN_ITEM_STATUS_LABELS: Record<
  CompensationPlanItemStatus,
  string
> = {
  NOT_STARTED: "Not started",
  RATING_DONE: "Rating done",
  MEETING_DONE: "Meeting done",
  COMPLETE: "Complete",
};

/**
 * Captions for the in-cell segmented control, where the column header already
 * supplies the word "Status" and horizontal space is the binding constraint.
 */
export const COMPENSATION_PLAN_ITEM_STATUS_SHORT: Record<
  CompensationPlanItemStatus,
  string
> = {
  NOT_STARTED: "—",
  RATING_DONE: "Rating",
  MEETING_DONE: "Meeting",
  COMPLETE: "Done",
};

/** Position on the ladder — for ordering rows and for "how far along is this". */
export function planItemStatusRank(status: CompensationPlanItemStatus): number {
  return COMPENSATION_PLAN_ITEM_STATUSES.indexOf(status);
}

/**
 * The currency the editor renders amounts in. `DEFAULT` means "each row in its
 * own compensation currency" — the only mode where two rows can disagree.
 */
export const DISPLAY_CURRENCY_MODES = ["DEFAULT", "CAD", "USD"] as const;

export type DisplayCurrencyMode = (typeof DISPLAY_CURRENCY_MODES)[number];

export const DISPLAY_CURRENCY_LABELS: Record<DisplayCurrencyMode, string> = {
  DEFAULT: "Default",
  CAD: "CAD",
  USD: "USD",
};

/**
 * The currency a given row renders in: its own under `DEFAULT`, otherwise the
 * chosen one. Returns null only when the row has no compensation currency at all
 * (no employment row) and no override is active — there is nothing to show.
 */
export function resolveDisplayCurrency(
  mode: DisplayCurrencyMode,
  rowCurrency: Currency | null,
): Currency | null {
  return mode === "DEFAULT" ? rowCurrency : mode;
}

export type PlanChangeInput = {
  currentAmount: number | null;
  currentCurrency: Currency | null;
  plannedAmount: number | null;
  plannedCurrency: Currency | null;
  /** The currency both legs are converted into before comparison. */
  displayCurrency: Currency | null;
  /** USD-based rate table (1 USD → currency), from `getExchangeRates()`. */
  usdRates: Record<Currency, number>;
};

export type PlanChange = {
  /** Current comp in `displayCurrency`, or null when unknown. */
  current: number | null;
  /** Planned comp in `displayCurrency`, or null when not yet proposed. */
  planned: number | null;
  /** planned − current, or null when either leg is unknown. */
  changeAmount: number | null;
  /** (planned / current) − 1 as a fraction, or null when current is 0/unknown. */
  changePercent: number | null;
};

const EMPTY_CHANGE: PlanChange = {
  current: null,
  planned: null,
  changeAmount: null,
  changePercent: null,
};

/**
 * The four money columns for one row, all denominated in `displayCurrency`.
 *
 * Both legs are converted BEFORE subtracting, which is what makes a cross-currency
 * proposal (a CAD salary moved to USD) a meaningful number rather than a subtraction
 * of unlike units. Because both legs cross-rate through the same table,
 * `changePercent` is invariant across display currencies — switching the toggle
 * re-denominates `current`/`changeAmount` but never moves the percentage.
 *
 * Every field is independently nullable: a staffer with no employment row, or one
 * whose planned figure hasn't been entered yet, yields nulls rather than NaN so the
 * grid renders an em dash (the same "empty → —, never NaN" rule as the dashboard).
 */
export function planChange({
  currentAmount,
  currentCurrency,
  plannedAmount,
  plannedCurrency,
  displayCurrency,
  usdRates,
}: PlanChangeInput): PlanChange {
  if (!displayCurrency) return EMPTY_CHANGE;

  const current =
    currentAmount != null && currentCurrency
      ? convert(currentAmount, currentCurrency, displayCurrency, usdRates)
      : null;
  const planned =
    plannedAmount != null && plannedCurrency
      ? convert(plannedAmount, plannedCurrency, displayCurrency, usdRates)
      : null;

  const changeAmount =
    current != null && planned != null ? planned - current : null;

  return {
    current,
    planned,
    changeAmount,
    changePercent: planChangePercent({
      currentAmount,
      currentCurrency,
      plannedAmount,
      plannedCurrency,
      usdRates,
    }),
  };
}

/**
 * The percentage change, computed from the NATIVE amounts rather than the
 * display-converted ones — so it is invariant across display currencies by
 * construction, not by arithmetic coincidence.
 *
 * Converting both legs into a target T and dividing gives
 * `((p/r_P)·r_T) / ((c/r_C)·r_T)`, where `r_T` cancels exactly. Deriving it from
 * the native figures skips that round trip: same answer, no float noise, and no
 * way for a future edit to accidentally make the toggle move the percentage.
 * When the two currencies match — the overwhelmingly common case — no FX is
 * involved at all.
 */
function planChangePercent({
  currentAmount,
  currentCurrency,
  plannedAmount,
  plannedCurrency,
  usdRates,
}: Omit<PlanChangeInput, "displayCurrency">): number | null {
  if (currentAmount == null || currentAmount === 0) return null;
  if (plannedAmount == null || !currentCurrency || !plannedCurrency)
    return null;

  if (plannedCurrency === currentCurrency)
    return plannedAmount / currentAmount - 1;

  // Cross-currency: compare both in USD terms. Any common currency would do —
  // the choice cancels — but USD is the table's own base, so it is one division.
  const plannedUsd = plannedAmount / usdRates[plannedCurrency];
  const currentUsd = currentAmount / usdRates[currentCurrency];
  return currentUsd === 0 ? null : plannedUsd / currentUsd - 1;
}

export type LevelTargetGapInput = {
  /** From `compTargetAnnual` — always an annual figure in `COMP_TARGET_CURRENCY`. */
  targetAnnual: number | null;
  /** The unit the person's own figures are in, i.e. what the target converts to. */
  unit: CompUnit;
  currentAmount: number | null;
  currentCurrency: Currency | null;
  plannedAmount: number | null;
  plannedCurrency: Currency | null;
  displayCurrency: Currency | null;
  usdRates: Record<Currency, number>;
};

export type LevelTargetGap = {
  /** The target in `displayCurrency`, restated in `unit`, or null. */
  target: number | null;
  /** target − planned, in `displayCurrency` and `unit`. Positive = below target. */
  gapAmount: number | null;
  /** The target increase % minus the proposed change %, as a fraction. */
  gapPercent: number | null;
};

const EMPTY_GAP: LevelTargetGap = {
  target: null,
  gapAmount: null,
  gapPercent: null,
};

/**
 * How far a proposal sits from the level's intended compensation.
 *
 * Two units are in play: the target table is annual, while an hourly person's
 * figures are hourly. Comparing them without converting would subtract unlike
 * units, so the target is restated in the person's own unit first — which makes
 * `HOURS_PER_YEAR` load-bearing for this column, not just for the display toggle.
 *
 * Sign: `target − planned`, so positive means the proposal is BELOW target (there
 * is headroom) and negative means it is above. The sign is forced by `gapPercent`
 * being "target increase % − proposed change %"; the two columns must agree or
 * they contradict each other.
 */
export function levelTargetGap({
  targetAnnual,
  unit,
  currentAmount,
  currentCurrency,
  plannedAmount,
  plannedCurrency,
  displayCurrency,
  usdRates,
}: LevelTargetGapInput): LevelTargetGap {
  if (targetAnnual == null || !displayCurrency) return EMPTY_GAP;

  // The target in the person's unit, still in the target's own currency.
  const targetNative = convertCompUnit(targetAnnual, COMP_TARGET_UNIT, unit);

  const target = convert(
    targetNative,
    COMP_TARGET_CURRENCY,
    displayCurrency,
    usdRates,
  );

  const planned =
    plannedAmount != null && plannedCurrency
      ? convert(plannedAmount, plannedCurrency, displayCurrency, usdRates)
      : null;

  return {
    target,
    gapAmount: planned != null ? target - planned : null,
    gapPercent: levelTargetGapPercent({
      targetNative,
      currentAmount,
      currentCurrency,
      plannedAmount,
      plannedCurrency,
      usdRates,
    }),
  };
}

/**
 * The gap as a percentage of current compensation — equivalently, the target
 * increase we'd need minus the increase we're proposing:
 *
 *   (target/current − 1) − (planned/current − 1)  =  (target − planned) / current
 *
 * The two forms are exactly equal (same denominator, the `−1`s cancel), and the
 * right-hand one is computed here: one division instead of two, and no chance of
 * the two percentages being derived inconsistently.
 *
 * Like {@link planChangePercent} this works from NATIVE amounts, cross-rating
 * through USD — so `displayCurrency` never appears and the toggle cannot move the
 * number. It is unit-invariant for the same structural reason: restating all three
 * legs in another unit multiplies them by one shared factor, which cancels in the
 * ratio.
 */
function levelTargetGapPercent({
  targetNative,
  currentAmount,
  currentCurrency,
  plannedAmount,
  plannedCurrency,
  usdRates,
}: {
  targetNative: number;
  currentAmount: number | null;
  currentCurrency: Currency | null;
  plannedAmount: number | null;
  plannedCurrency: Currency | null;
  usdRates: Record<Currency, number>;
}): number | null {
  if (currentAmount == null || currentAmount === 0 || !currentCurrency)
    return null;
  if (plannedAmount == null || !plannedCurrency) return null;

  const targetUsd = targetNative / usdRates[COMP_TARGET_CURRENCY];
  const plannedUsd = plannedAmount / usdRates[plannedCurrency];
  const currentUsd = currentAmount / usdRates[currentCurrency];
  if (currentUsd === 0) return null;

  return (targetUsd - plannedUsd) / currentUsd;
}

/**
 * The figure a "+p%" quick pick writes: current compensation restated in the
 * proposal's currency and raised by `percent`.
 *
 * Denominated in the PROPOSAL's currency and the person's canonical unit — i.e.
 * exactly what gets persisted — because a saved number must never depend on a
 * display toggle. `item.current.amount` is already canonical (see
 * {@link currentCompAmount}), so no unit conversion happens here at all.
 */
export function raisedFromCurrent({
  currentAmount,
  currentCurrency,
  plannedCurrency,
  unit,
  percent,
  usdRates,
}: {
  currentAmount: number | null;
  currentCurrency: Currency | null;
  plannedCurrency: Currency | null;
  unit: CompUnit;
  percent: number;
  usdRates: Record<Currency, number>;
}): number | null {
  if (currentAmount == null || !currentCurrency || !plannedCurrency)
    return null;

  const base =
    plannedCurrency === currentCurrency
      ? currentAmount
      : convert(currentAmount, currentCurrency, plannedCurrency, usdRates);

  return roundForUnit(base * (1 + percent), unit);
}

/**
 * Whole months elapsed since `date` (a `"YYYY-MM-DD"` calendar date), or null when
 * the date is missing or in the future. Drives the "new joiner" tenure chip, so it
 * counts completed months rather than rounding — someone 29 days in reads as 0.
 */
export function monthsSince(date: string | null, now: Date): number | null {
  if (!date) return null;
  const [year, month, day] = date.split("-").map(Number);
  if (!year || !month || !day) return null;

  let months = (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month);
  // Not yet past the anniversary day this month → the month isn't complete.
  if (now.getDate() < day) months -= 1;
  return months < 0 ? null : months;
}

/** Tenure under a year is the interesting case — the chip shows only then. */
export const NEW_JOINER_MONTHS = 12;

/**
 * The compensation figure a plan proposes against, by employment type: an annual
 * base for salaried staff, an hourly rate for hourly staff. One number per person
 * (bonuses are out of scope for a plan), so this is the single place that mapping
 * is decided.
 */
export function currentCompAmount(
  employment: {
    employmentType: "FULL_TIME" | "HOURLY";
    base: number;
    hourlyRate: number;
  } | null,
): number | null {
  if (!employment) return null;
  return employment.employmentType === "HOURLY"
    ? employment.hourlyRate
    : employment.base;
}
