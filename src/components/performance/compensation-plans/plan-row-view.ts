import type { CompensationPlanEditorItem } from "@/actions/performance/getCompensationPlan";
import type { Currency } from "@/lib/format/currency";
import { convert } from "@/lib/format/fx";
import {
  bonusPercent,
  type DisplayCurrencyMode,
  type LevelTargetGap,
  levelTargetGap,
  type PlanBonusRow,
  type PlanChange,
  planChange,
  planItemStatusRank,
  resolveDisplayCurrency,
} from "@/lib/performance/compensation-plan";
import { compTargetAnnual } from "@/lib/performance/compensation-targets";
import {
  type CompUnit,
  convertCompUnit,
} from "@/lib/performance/compensation-unit";
import { decodeLevelValue } from "@/lib/staff/staff-rating";
import type { PlanRowDraft } from "./use-plan-autosave";

/**
 * One row's derived numbers, computed once in the editor and handed to both the
 * cells and the sort comparator.
 *
 * The reason this exists rather than each cell deriving its own: sorting on Change %
 * or Gap % needs the same values the cells show, and two independent derivations of
 * FX-and-unit-converted money would drift. One model, one set of numbers, no way for
 * the order to disagree with what is on screen.
 */

/**
 * Money keys normalized to ANNUAL USD so a mixed cohort orders meaningfully.
 *
 * Two things make the displayed numbers unsortable as-is: under `DEFAULT` each row
 * shows its own currency (so CAD would compare against USD), and canonical amounts
 * mix dollars-per-year with dollars-per-hour. Normalizing both away is what makes
 * "sort by Current" mean anything across the whole plan. The percentage keys need no
 * normalizing — they are already currency- and unit-free.
 */
export type PlanRowSortValues = {
  name: string;
  rating: number | null;
  currentAnnualUsd: number | null;
  plannedAnnualUsd: number | null;
  changeAnnualUsd: number | null;
  gapAnnualUsd: number | null;
  /**
   * The bonus in USD — currency-normalized like the others but NOT annualized: a
   * lump sum is already a total, and multiplying it by `HOURS_PER_YEAR` for an
   * hourly staffer would order the column by employment type.
   */
  bonusUsd: number | null;
  changePercent: number | null;
  gapPercent: number | null;
  bonusPercent: number | null;
  status: number;
};

export type PlanRowView = {
  item: CompensationPlanEditorItem;
  draft: PlanRowDraft;
  /** The currency every money cell in this row renders in. */
  currency: Currency | null;
  /** The unit every money cell in this row renders in. */
  unit: CompUnit;
  /** The unit the row's stored figures are in. */
  canonicalUnit: CompUnit;
  /** Current / planned / change, in `currency`, still in `canonicalUnit`. */
  change: PlanChange;
  /** Target / gap, in `currency`, still in `canonicalUnit`. */
  gap: LevelTargetGap;
  /**
   * The lump-sum bonus in `currency`, and what it is worth as a fraction of
   * current compensation.
   *
   * Deliberately its own member rather than a leg of `change` or `gap`: those
   * columns are about ongoing pay, and `inRowUnit` must never be applied to
   * `amount` — a one-off is not a rate.
   */
  bonus: { amount: number | null; percent: number | null };
  /** The level the target lookup used — null when there was none to use. */
  targetLevel: number | null;
  sort: PlanRowSortValues;
};

/**
 * The row reduced to what a plan-level bonus total needs. Keeps the aggregation in
 * the pure module ({@link planBonusTotals}) working from the same draft values the
 * cells render, so the total can never disagree with the column above it.
 */
export function bonusRow(view: PlanRowView): PlanBonusRow {
  return {
    bonusAmount: view.draft.plannedBonus,
    bonusCurrency: view.draft.plannedCurrency,
    currentAmount: view.item.current.amount,
    currentCurrency: view.item.current.currency,
    unit: view.canonicalUnit,
  };
}

/** Restate one of this row's canonical-unit amounts in its display unit. */
export function inRowUnit(view: PlanRowView, amount: number): number {
  return convertCompUnit(amount, view.canonicalUnit, view.unit);
}

/** An amount in `currency` and `unit`, restated as annual USD for ordering. */
function annualUsd(
  amount: number | null,
  currency: Currency | null,
  unit: CompUnit,
  usdRates: Record<Currency, number>,
): number | null {
  if (amount == null || !currency) return null;
  return convertCompUnit(amount, unit, "ANNUAL") / usdRates[currency];
}

export function buildPlanRowView({
  item,
  draft,
  displayMode,
  usdRates,
}: {
  item: CompensationPlanEditorItem;
  draft: PlanRowDraft;
  displayMode: DisplayCurrencyMode;
  usdRates: Record<Currency, number>;
}): PlanRowView {
  // The row's own currency under "Default", the forced one otherwise. Falls back
  // to the planned currency so a person with no employment row still renders.
  const currency = resolveDisplayCurrency(
    displayMode,
    item.current.currency ?? draft.plannedCurrency,
  );

  const change = planChange({
    currentAmount: item.current.amount,
    currentCurrency: item.current.currency,
    plannedAmount: draft.plannedCanonical,
    plannedCurrency: draft.plannedCurrency,
    displayCurrency: currency,
    usdRates,
  });

  // The PROPOSED level drives the target: committing the plan is what writes that
  // level, so the band being judged against is the one the person is moving into.
  // Falls back to their last saved level so the columns are useful before anyone
  // touches the Rating select; unrated with no history yields no target at all.
  const targetLevel = decodeLevelValue(draft.level) ?? item.lastLevel;

  const gap = levelTargetGap({
    targetAnnual: compTargetAnnual({
      role: item.role,
      billableType: item.billableType,
      level: targetLevel,
    }),
    unit: draft.canonicalUnit,
    currentAmount: item.current.amount,
    currentCurrency: item.current.currency,
    plannedAmount: draft.plannedCanonical,
    plannedCurrency: draft.plannedCurrency,
    displayCurrency: currency,
    usdRates,
  });

  // No `convertCompUnit` anywhere on either leg — see `bonus` on `PlanRowView`.
  const bonusAmount =
    draft.plannedBonus != null && draft.plannedCurrency && currency
      ? convert(draft.plannedBonus, draft.plannedCurrency, currency, usdRates)
      : null;

  const bonusFraction = bonusPercent({
    bonusAmount: draft.plannedBonus,
    bonusCurrency: draft.plannedCurrency,
    currentAmount: item.current.amount,
    currentCurrency: item.current.currency,
    unit: draft.canonicalUnit,
    usdRates,
  });

  return {
    item,
    draft,
    currency,
    unit: draft.plannedUnit,
    canonicalUnit: draft.canonicalUnit,
    change,
    gap,
    bonus: { amount: bonusAmount, percent: bonusFraction },
    targetLevel,
    sort: {
      name: item.name,
      rating: decodeLevelValue(draft.level),
      currentAnnualUsd: annualUsd(
        item.current.amount,
        item.current.currency,
        draft.canonicalUnit,
        usdRates,
      ),
      plannedAnnualUsd: annualUsd(
        draft.plannedCanonical,
        draft.plannedCurrency,
        draft.canonicalUnit,
        usdRates,
      ),
      changeAnnualUsd: annualUsd(
        change.changeAmount,
        currency,
        draft.canonicalUnit,
        usdRates,
      ),
      gapAnnualUsd: annualUsd(
        gap.gapAmount,
        currency,
        draft.canonicalUnit,
        usdRates,
      ),
      bonusUsd:
        draft.plannedBonus != null && draft.plannedCurrency
          ? draft.plannedBonus / usdRates[draft.plannedCurrency]
          : null,
      changePercent: change.changePercent,
      gapPercent: gap.gapPercent,
      bonusPercent: bonusFraction,
      status: planItemStatusRank(draft.status),
    },
  };
}
