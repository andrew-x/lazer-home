/**
 * The peer-feedback rating scale. Declared here as a pure, client-importable
 * module (no `db`/drizzle) so the `feedbackRatingEnum` pgEnum in
 * `performance-schema.ts`, the zod schema, and the client form's radio group all
 * share exactly one source of truth (mirrors `@/lib/crm/line-of-business`; see
 * ADR 0016 on the shared-enum convention).
 */
export const FEEDBACK_RATINGS = [
  "ABOVE_AND_BEYOND",
  "TOP_PERFORMER",
  "SOLID_CONTRIBUTOR",
  "MINOR_MISSES",
  "NEEDS_IMPROVEMENT",
] as const;

export type FeedbackRating = (typeof FEEDBACK_RATINGS)[number];

/** Human-readable labels for each rating. */
export const FEEDBACK_RATING_LABELS: Record<FeedbackRating, string> = {
  ABOVE_AND_BEYOND: "Above and beyond",
  TOP_PERFORMER: "Top performer",
  SOLID_CONTRIBUTOR: "Solid contributor",
  MINOR_MISSES: "Minor misses",
  NEEDS_IMPROVEMENT: "Needs improvement",
};

/** One-line descriptions shown beside each option in the rating picker. */
export const FEEDBACK_RATING_DESCRIPTIONS: Record<FeedbackRating, string> = {
  ABOVE_AND_BEYOND: "Consistently exceeded expectations; exceptional impact.",
  TOP_PERFORMER: "Regularly strong work; a standout on the team.",
  SOLID_CONTRIBUTOR: "Reliably met expectations and delivered good work.",
  MINOR_MISSES: "Mostly solid, with a few areas that fell short.",
  NEEDS_IMPROVEMENT: "Fell short of expectations in meaningful ways.",
};
