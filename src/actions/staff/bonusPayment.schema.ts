import { z } from "zod";
import { CURRENCY } from "@/lib/format/currency";
import { dateString } from "@/lib/schemas/date-schema";
import { id } from "@/lib/schemas/id-schema";
import { optionalText } from "@/lib/schemas/text-schema";
import { BONUS_TYPES } from "@/lib/staff/staff-bonus";

/**
 * Shared validation for the bonus-payment family (create / update / delete). A
 * pure, client-importable module (no `db`/drizzle) so the entry dialog's resolver
 * and the actions share one schema.
 *
 * Note what is NOT here: `ripplingId`. It belongs to the future importer and is
 * never client-supplied — accepting it would let a hand-entered row squat on the
 * unique key a real Rippling payment needs.
 */

/** Free-text notes cap. Long enough for "Q2 milestone — Acme phase 2 delivery". */
export const BONUS_NOTES_MAX = 500;

/** Two decimal places, matching `numeric(12, 2)`. */
const MONEY_STEP = 100;
/** `numeric(12, 2)` holds at most 10 integer digits. */
const MONEY_MAX = 9_999_999_999.99;

/**
 * A money amount for a bonus: strictly positive (a zero bonus is not a payment,
 * and the DB check constraint agrees) and no finer than cents, so a value that
 * silently rounds on insert is rejected at the edge instead.
 */
const bonusAmount = z
  .number()
  .positive("Enter an amount greater than zero.")
  .max(MONEY_MAX, "That amount is too large.")
  .refine(
    (value) =>
      Number.isInteger(Math.round(value * MONEY_STEP)) &&
      Math.abs(value * MONEY_STEP - Math.round(value * MONEY_STEP)) < 1e-9,
    "Use at most two decimal places.",
  );

/** The editable content of a payment, identical on create and update. */
export const bonusPaymentFields = {
  /**
   * When it was paid — not when it was recorded. Bounded to today or earlier: this
   * table records payments that HAVE happened, and a future-dated row would inflate
   * a year's total with money not yet spent. Scheduling belongs to payroll.
   */
  paymentDate: dateString.refine(
    (value) => value <= todayIso(),
    "A payment date can't be in the future.",
  ),
  type: z.enum(BONUS_TYPES),
  amount: bonusAmount,
  currency: z.enum(CURRENCY),
  // `optionalText`, not `optionalTrimmedText`: it accepts null/undefined on input
  // too, so an already-validated (null) value can go straight back to the action
  // without failing re-validation.
  notes: optionalText(
    BONUS_NOTES_MAX,
    `Keep notes under ${BONUS_NOTES_MAX} characters.`,
  ),
};

/**
 * Today as "YYYY-MM-DD" in the runtime's local zone. Deliberately not imported
 * from a date library: the comparison is against a wall-clock date string, and the
 * only thing that matters is that someone in the office can't post tomorrow.
 */
function todayIso(): string {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** Just the content — the resolver behind the entry dialog, create or edit alike. */
export const bonusPaymentContentSchema = z.object(bonusPaymentFields);
/** What the form's fields hold while typing (`notes` is "" when cleared). */
export type BonusPaymentContentInput = z.input<
  typeof bonusPaymentContentSchema
>;
/** What validation produces, and what the actions take (`notes` is null when blank). */
export type BonusPaymentContentValues = z.output<
  typeof bonusPaymentContentSchema
>;

/** `staffId` is who was paid. */
export const createBonusPaymentSchema = z.object({
  staffId: id,
  ...bonusPaymentFields,
});
export type CreateBonusPaymentInput = z.input<typeof createBonusPaymentSchema>;

/**
 * Updates carry the full content. `staffId` is deliberately absent — a payment
 * recorded against the wrong person is deleted and re-entered, rather than
 * silently moving money between people's records.
 */
export const updateBonusPaymentSchema = z.object({
  paymentId: id,
  ...bonusPaymentFields,
});
export type UpdateBonusPaymentInput = z.input<typeof updateBonusPaymentSchema>;

export const deleteBonusPaymentSchema = z.object({ paymentId: id });
export type DeleteBonusPaymentInput = z.input<typeof deleteBonusPaymentSchema>;
