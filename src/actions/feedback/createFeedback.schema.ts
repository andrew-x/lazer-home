import { z } from "zod";
import { FEEDBACK_RATINGS } from "@/lib/performance/feedback-rating";
import { optionalText } from "@/lib/schemas/text-schema";

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
    keepDoing: optionalText(5000, "Keep it under 5000 characters"),
    stopDoing: optionalText(5000, "Keep it under 5000 characters"),
    startDoing: optionalText(5000, "Keep it under 5000 characters"),
    other: optionalText(5000, "Keep it under 5000 characters"),
    messageToRecipient: optionalText(5000, "Keep it under 5000 characters"),
  })
  .refine((v) => Boolean(v.keepDoing || v.stopDoing || v.startDoing), {
    message: "Add at least one of keep / stop / start doing",
    path: ["keepDoing"],
  });

export type CreateFeedbackInput = z.input<typeof createFeedbackSchema>;
