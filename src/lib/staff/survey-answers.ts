/**
 * The single definition of "this survey question has been answered", shared by
 * every reader of the generic `responses` table (Manual of Me, Ways of Working —
 * see docs/domains/staff-profiles.md and ADR 0028).
 *
 * A pure, client-importable module (no `db`/drizzle): the profile-completeness
 * table and the per-person survey reads must agree on the count, and they did
 * not before this existed — `getWaysOfWorking` tested both shapes while the
 * profile view tested `textResponse` alone, so a person whose only answers were
 * multi-selects counted as answered in one place and unanswered in the other.
 */

/** The two response shapes a survey question can use. A question uses exactly
 * one; the other stays null. Deliberately structural rather than the DB row type,
 * so client components can import this. */
export type SurveyAnswerShape = {
  textResponse: string | null;
  listResponse: string[] | null;
};

/**
 * Whether an answer counts as given. An empty `listResponse` is NOT an answer:
 * clearing every option from a multi-select leaves the row behind with `[]`, and
 * counting that would report a cleared question as still answered.
 */
export function isResponseAnswered({
  textResponse,
  listResponse,
}: SurveyAnswerShape): boolean {
  return (
    textResponse !== null || (listResponse !== null && listResponse.length > 0)
  );
}
