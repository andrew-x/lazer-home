import { z } from "zod";
import { id } from "@/lib/schemas/id-schema";
import { MAX_RATING_LEVEL, MIN_RATING_LEVEL } from "@/lib/staff/staff-rating";

/**
 * One staff member's new level in an evaluation. `level` is an integer 0–4, or
 * `null` to (re)mark them unrated. The client sends every row it wants to change;
 * the action drops no-ops against the current level server-side.
 */
const ratingChangeSchema = z.object({
  staffId: id,
  level: z
    .number()
    .int()
    .min(MIN_RATING_LEVEL)
    .max(MAX_RATING_LEVEL)
    .nullable(),
});

/**
 * Evaluation payload: the changed rows and an optional effective date (defaults
 * to today, server-side). Each change becomes a new dated `staff_rating` row so
 * the level history is preserved.
 */
export const saveStaffEvaluationSchema = z.object({
  effectiveDate: z.iso.date().optional(),
  changes: z.array(ratingChangeSchema).min(1),
});

export type RatingChange = z.infer<typeof ratingChangeSchema>;
export type SaveStaffEvaluationInput = z.infer<
  typeof saveStaffEvaluationSchema
>;
