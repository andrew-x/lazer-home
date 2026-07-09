import { z } from "zod";
import { FEEDBACK_RATINGS } from "@/lib/feedback-rating";

/**
 * Optional free-text field: trimmed, capped, and normalized so a blank entry
 * becomes `undefined` (stored as null) rather than an empty string.
 */
const optionalText = z
  .string()
  .trim()
  .max(5000, "Keep it under 5000 characters")
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

/**
 * Input for leaving peer feedback. `fromStaffId` is NOT in the input — the caller
 * is resolved server-side from the session (you can only leave feedback as
 * yourself). At least one of keep/stop/start is required (the actionable core of
 * the feedback); recipient, rating, and context are always required.
 */
export const createFeedbackSchema = z
  .object({
    toStaffId: z.string().min(1, "Choose who this feedback is for"),
    rating: z.enum(FEEDBACK_RATINGS, {
      message: "Pick a rating",
    }),
    context: z
      .string()
      .trim()
      .min(1, "Describe how and when you worked together")
      .max(5000, "Keep it under 5000 characters"),
    keepDoing: optionalText,
    stopDoing: optionalText,
    startDoing: optionalText,
    other: optionalText,
    messageToRecipient: optionalText,
  })
  .refine((v) => Boolean(v.keepDoing || v.stopDoing || v.startDoing), {
    message: "Add at least one of keep / stop / start doing",
    path: ["keepDoing"],
  });

export type CreateFeedbackInput = z.input<typeof createFeedbackSchema>;
