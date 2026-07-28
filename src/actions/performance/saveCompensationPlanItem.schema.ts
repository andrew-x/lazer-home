// Client-imported: `use-plan-autosave.ts` imports the patch type, so this must
// stay drizzle-free hand-written zod (ADR 0035).
import { z } from "zod";
import { CURRENCY } from "@/lib/format/currency";
import { SUBRATING_MAX, SUBRATING_MIN } from "@/lib/performance/rating-rubric";
import { id } from "@/lib/schemas/id-schema";
import { MAX_RATING_LEVEL, MIN_RATING_LEVEL } from "@/lib/staff/staff-rating";

export const PLAN_NOTES_MAX = 4000;

/** Fits `numeric(12, 2)` — the column's own ceiling, stated once. */
export const PLANNED_AMOUNT_MAX = 9_999_999_999.99;

/**
 * Free text in a patch: absent means "not being changed", `""` means "cleared".
 *
 * Deliberately NOT `optionalText`, which folds `undefined` into `null` — in a
 * partial patch that would turn every unsent note field into a deletion.
 */
const patchNotes = z
  .string()
  .max(PLAN_NOTES_MAX, `Keep notes under ${PLAN_NOTES_MAX} characters.`)
  .transform((value) => value.trim() || null)
  .optional();

/**
 * The editable surface of one plan row. Every field is optional and only the
 * present ones are written, so two people editing different fields of the same
 * row never clobber each other, and a single keystroke doesn't resend the row.
 *
 * `subratings` keys are validated loosely here (any string → 1–4) because the
 * valid set is role-dependent and therefore only knowable server-side; the action
 * hardens them against the person's current role rubric.
 */
const patchSchema = z
  .object({
    level: z
      .number()
      .int()
      .min(MIN_RATING_LEVEL)
      .max(MAX_RATING_LEVEL)
      .nullable()
      .optional(),
    subratings: z
      .record(
        z.string(),
        z.number().int().min(SUBRATING_MIN).max(SUBRATING_MAX),
      )
      .nullable()
      .optional(),
    plannedAmount: z
      .number()
      .min(0, "Compensation can't be negative.")
      .max(PLANNED_AMOUNT_MAX)
      .nullable()
      .optional(),
    plannedCurrency: z.enum(CURRENCY).nullable().optional(),
    ratingDone: z.boolean().optional(),
    meetingDone: z.boolean().optional(),
    isComplete: z.boolean().optional(),
    evaluationNotes: patchNotes,
    compensationNotes: patchNotes,
  })
  .refine((patch) => Object.keys(patch).length > 0, "Nothing to save.");

export const saveCompensationPlanItemSchema = z.object({
  planId: id,
  itemId: id,
  patch: patchSchema,
});

export type CompensationPlanItemPatch = z.input<typeof patchSchema>;
export type SaveCompensationPlanItemInput = z.infer<
  typeof saveCompensationPlanItemSchema
>;
