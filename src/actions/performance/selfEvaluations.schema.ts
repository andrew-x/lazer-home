import { z } from "zod";
import { FEEDBACK_RATINGS } from "@/lib/performance/feedback-rating";
import {
  SELF_EVALUATION_ANSWER_MAX,
  SELF_EVALUATION_QUESTION_IDS,
  type SelfEvaluationQuestionId,
} from "@/lib/performance/self-evaluation";
import { id } from "@/lib/schemas/id-schema";
import { optionalText } from "@/lib/schemas/text-schema";

/**
 * Shared validation for the self-evaluation family (create / update / delete). A
 * pure, client-importable module (no `db`/drizzle) so the form and the actions
 * share one schema.
 *
 * Note what is NOT here: **the stored snapshot.** The client sends only raw answer
 * text keyed by question id; each entry's `section` and `prompt` are derived
 * server-side from the current question set via `buildSelfEvaluationEntries`.
 * Accepting them from the client would let a crafted payload store a fabricated
 * prompt above a real answer — an integrity hole in a document whose entire value
 * is being a faithful record of what was asked. `questionSetVersion` is stamped
 * server-side for the same reason.
 */

/**
 * One optional textarea per question, generated FROM the id tuple so adding a
 * question can't be forgotten here. Blank → null, which
 * `buildSelfEvaluationEntries` then drops from the record entirely.
 *
 * `optionalText`, not `optionalTrimmedText`: it accepts null/undefined on input as
 * well, so the form can hand its already-validated (already-null) answers straight to
 * the action without the round-trip failing re-validation — the same reason
 * `reviewNoteFields.title` uses it.
 */
const answerFields = Object.fromEntries(
  SELF_EVALUATION_QUESTION_IDS.map((questionId) => [
    questionId,
    optionalText(
      SELF_EVALUATION_ANSWER_MAX,
      `Keep each answer under ${SELF_EVALUATION_ANSWER_MAX.toLocaleString()} characters.`,
    ),
  ]),
) as Record<SelfEvaluationQuestionId, ReturnType<typeof optionalText>>;

/**
 * The editable content of a self-evaluation, identical on create and update.
 *
 * No date of any kind: there is no draft state, so the submission time is simply
 * `createdAt`, stamped by the database. Accepting one from the client would let a
 * record claim to have been submitted when it wasn't.
 */
export const selfEvaluationFields = {
  // Required: it is the summary judgement, and it guarantees no record is empty.
  // The tuple is peer feedback's (ADR 0016) — see `SELF_RATING_DESCRIPTIONS`.
  selfRating: z.enum(FEEDBACK_RATINGS, { message: "Pick a rating" }),
  answers: z.object(answerFields),
};

/**
 * Just the content — the resolver behind the panel's form, whose shape is the same
 * whether it is creating or editing (the ids are supplied at submit, not typed).
 */
export const selfEvaluationContentSchema = z.object(selfEvaluationFields);
/** What the form's fields hold while typing (every answer is a string, "" when cleared). */
export type SelfEvaluationContentInput = z.input<
  typeof selfEvaluationContentSchema
>;
/** What validation produces, and what the actions take (blank answers are null). */
export type SelfEvaluationContentValues = z.output<
  typeof selfEvaluationContentSchema
>;

/**
 * No `staffId`: you can only write a self-evaluation as yourself, so the subject is
 * resolved from the session inside the action. There is nothing here to forge.
 */
export const createSelfEvaluationSchema = z.object(selfEvaluationFields);
export type CreateSelfEvaluationInput = z.input<
  typeof createSelfEvaluationSchema
>;

/**
 * Updates carry the full content; the action never changes a record's subject or
 * its question-set version. `evaluationId` is the input
 * `authorizeSelfEvaluationMutate` gates on — it resolves the author server-side
 * rather than trusting the client for it.
 */
export const updateSelfEvaluationSchema = z.object({
  evaluationId: id,
  ...selfEvaluationFields,
});
export type UpdateSelfEvaluationInput = z.input<
  typeof updateSelfEvaluationSchema
>;

export const deleteSelfEvaluationSchema = z.object({ evaluationId: id });
export type DeleteSelfEvaluationInput = z.input<
  typeof deleteSelfEvaluationSchema
>;
